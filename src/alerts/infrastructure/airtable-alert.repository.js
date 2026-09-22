// ============================================================================
// airtable-alert.repository.js (INFRAESTRUCTURA) — ALERTAS Y NOTIFICACIONES EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-alert.repository.js. Los textos de las notificaciones
// están en ../domain/alert.mensajes.js (compartidos con la versión de Postgres).
// ============================================================================

const { AlertRepository } = require('../domain/alert.repository');
const { TITULOS_ALERTA, construirMensaje } = require('../domain/alert.mensajes');
const { textoFormula, combinarFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'alertas_combustible';
const TABLA_NOTIFICACIONES = 'notificaciones_combustible';
const fechaFormula = (valor) => `DATETIME_FORMAT({fecha},'YYYY-MM-DD')=${textoFormula(valor)}`;

class AirtableAlertRepository extends AlertRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  async list() {
    return this.cliente.listar(TABLA, {
      orden: [
        { campo: 'fecha', direccion: 'desc' },
        { campo: 'creado_en', direccion: 'desc' }
      ]
    });
  }

  async findById(id) {
    return this.cliente.obtener(TABLA, id);
  }

  async findByRegistro(registroId, tipo = 'sobrecapacidad', connection = this.cliente) {
    const filas = await connection.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{registro_id}=${textoFormula(registroId)}`,
        `{tipo_alerta}=${textoFormula(tipo)}`
      ]),
      maxFilas: 1
    });
    return filas[0] || null;
  }

  async findByJornada(jornadaId, tipo, connection = this.cliente) {
    const filas = await connection.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{jornada_id}=${textoFormula(jornadaId)}`,
        `{tipo_alerta}=${textoFormula(tipo)}`
      ]),
      maxFilas: 1
    });
    return filas[0] || null;
  }

  async resolverPorJornada(jornadaId, tipo, usuario, connection = this.cliente) {
    const pendientes = await connection.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{jornada_id}=${textoFormula(jornadaId)}`,
        `{tipo_alerta}=${textoFormula(tipo)}`,
        `{estado}!='justificada'`
      ])
    });
    if (!pendientes.length) return 0;
    const ahora = new Date().toISOString();
    await connection.actualizar(
      TABLA,
      pendientes.map((a) => ({
        id: a.id,
        campos: {
          estado: 'justificada',
          justificacion: a.justificacion || 'Jornada cerrada.',
          justificado_por: usuario || null,
          justificado_en: ahora
        }
      }))
    );
    const notificaciones = (
      await Promise.all(
        pendientes.map((a) =>
          connection.listar(TABLA_NOTIFICACIONES, { formula: `{alerta_id}=${textoFormula(a.id)}` })
        )
      )
    ).flat();
    if (notificaciones.length)
      await connection.actualizar(
        TABLA_NOTIFICACIONES,
        notificaciones.map((n) => ({ id: n.id, campos: { leida: true, leida_en: ahora } }))
      );
    return pendientes.length;
  }

  async create(alerta, connection = this.cliente) {
    const tipoAlerta = alerta.tipoAlerta || 'sobrecapacidad';
    const [fila] = await connection.crear(TABLA, [
      {
        registro_id: alerta.registroId || null,
        jornada_id: alerta.jornadaId || null,
        fecha: alerta.fecha || null,
        maquina: alerta.maquina || null,
        operario: alerta.operario || null,
        cantidad: alerta.cantidad ?? null,
        capacidad_galones: alerta.capacidadGalones ?? 0,
        exceso_galones: alerta.excesoGalones ?? null,
        observaciones: alerta.observaciones || null,
        estado: 'pendiente',
        tipo_alerta: tipoAlerta,
        promedio_galones: alerta.promedioGalones ?? null,
        porcentaje_sobre_promedio: alerta.porcentajeSobrePromedio ?? null,
        detalle_alerta: alerta.detalle || null,
        valor_referencia: alerta.valorReferencia ?? null,
        creado_en: new Date().toISOString()
      }
    ]);
    const id = fila.id;

    // Una notificación por rol (si ya existía una para esta alerta y ese rol, se actualiza en vez de duplicarla).
    const titulo = TITULOS_ALERTA[tipoAlerta] || TITULOS_ALERTA.sobrecapacidad;
    const mensaje = construirMensaje({ ...alerta, tipoAlerta });
    for (const rol of ['super_administrador', 'supervisor', 'administrador']) {
      const existentes = await connection.listar(TABLA_NOTIFICACIONES, {
        formula: combinarFormula('AND', [
          `{alerta_id}=${textoFormula(id)}`,
          `{rol}=${textoFormula(rol)}`
        ]),
        maxFilas: 1
      });
      if (existentes.length)
        await connection.actualizar(TABLA_NOTIFICACIONES, [
          { id: existentes[0].id, campos: { mensaje } }
        ]);
      else
        await connection.crear(TABLA_NOTIFICACIONES, [
          { alerta_id: id, rol, titulo, mensaje, leida: false, creado_en: new Date().toISOString() }
        ]);
    }

    return {
      id,
      nueva: true,
      registroId: alerta.registroId,
      jornadaId: alerta.jornadaId,
      fecha: alerta.fecha,
      maquina: alerta.maquina,
      operario: alerta.operario,
      cantidad: alerta.cantidad,
      capacidadGalones: alerta.capacidadGalones,
      excesoGalones: alerta.excesoGalones,
      observaciones: alerta.observaciones,
      justificacion: null,
      estado: 'pendiente',
      tipoAlerta,
      promedioGalones: alerta.promedioGalones ?? null,
      porcentajeSobrePromedio: alerta.porcentajeSobrePromedio ?? null,
      detalleAlerta: alerta.detalle ?? null,
      valorReferencia: alerta.valorReferencia ?? null
    };
  }

  async update(id, datos) {
    const columnasPermitidas = {
      justificacion: 'justificacion',
      estado: 'estado',
      justificadoPor: 'justificado_por',
      justificadoEn: 'justificado_en',
      reporteNombre: 'reporte_nombre',
      reporteRuta: 'reporte_ruta',
      reporteTipo: 'reporte_tipo'
    };
    const campos = {};
    for (const [campo, columna] of Object.entries(columnasPermitidas))
      if (datos[campo] !== undefined) campos[columna] = datos[campo];
    if (!Object.keys(campos).length) return false;
    await this.cliente.actualizar(TABLA, [{ id, campos }]);
    return true;
  }

  async listNotifications(rol) {
    return this.cliente.listar(TABLA_NOTIFICACIONES, {
      formula: `{rol}=${textoFormula(rol)}`,
      orden: [
        { campo: 'leida', direccion: 'asc' },
        { campo: 'creado_en', direccion: 'desc' }
      ],
      maxFilas: 50
    });
  }

  async markNotification(id, rol) {
    const fila = await this.cliente.obtener(TABLA_NOTIFICACIONES, id);
    if (fila && fila.rol === rol)
      await this.cliente.actualizar(TABLA_NOTIFICACIONES, [
        { id, campos: { leida: true, leida_en: new Date().toISOString() } }
      ]);
    return true;
  }

  async markNotificationsForAlert(alertaId) {
    const filas = await this.cliente.listar(TABLA_NOTIFICACIONES, {
      formula: `{alerta_id}=${textoFormula(alertaId)}`
    });
    if (filas.length)
      await this.cliente.actualizar(
        TABLA_NOTIFICACIONES,
        filas.map((n) => ({
          id: n.id,
          campos: { leida: true, leida_en: new Date().toISOString() }
        }))
      );
    return true;
  }

  async listByDateRange(inicio, fin) {
    return this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', [
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>=${textoFormula(inicio)}`,
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fin)}`
      ]),
      orden: [
        { campo: 'fecha', direccion: 'asc' },
        { campo: 'creado_en', direccion: 'asc' }
      ]
    });
  }
}

module.exports = { AirtableAlertRepository };
