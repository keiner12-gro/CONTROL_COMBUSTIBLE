// ============================================================================
// airtable-jornada.repository.js (INFRAESTRUCTURA) — JORNADAS EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-jornada.repository.js.
// ⚠ DIFERENCIA IMPORTANTE con Postgres: "un solo cierre por día" allí lo
// garantiza la base de datos de forma atómica (UPSERT con WHERE bloqueante).
// Airtable no tiene esa garantía: aquí se hace "leer y luego escribir", que
// deja una ventana mínima donde dos cierres SIMULTÁNEOS podrían pisarse. Se
// acepta este riesgo porque, en esta operación, el registro y cierre de la
// jornada los hace una sola persona a la vez (no hay dos personas cerrando el
// mismo día al mismo tiempo). Si eso cambiara, habría que resolverlo aparte.
// ============================================================================

const { COLUMNAS } = require('./pg-jornada.repository'); // Reutiliza el mismo mapa camelCase -> columna
const { textoFormula, combinarFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'jornadas_combustible';
const TABLA_REGISTROS = 'registros_combustible';
const fechaFormula = (campo, valor) =>
  `DATETIME_FORMAT({${campo}},'YYYY-MM-DD')=${textoFormula(valor)}`;

class AirtableJornadaRepository {
  constructor(cliente) {
    this.cliente = cliente;
  }

  transaction(funcion) {
    return this.cliente.transaction(funcion);
  }

  async findByFecha(fecha, tx = this.cliente) {
    const filas = await tx.listar(TABLA, { formula: fechaFormula('fecha', fecha), maxFilas: 1 });
    return filas[0] || null;
  }

  async findById(id, tx = this.cliente) {
    return tx.obtener(TABLA, id);
  }

  async guardar(
    fecha,
    campos,
    usuario,
    { cerrar = false, permitirCerrada = false } = {},
    tx = this.cliente
  ) {
    const camposDb = {};
    for (const [campo, valor] of Object.entries(campos || {}))
      if (COLUMNAS[campo] && valor !== undefined) camposDb[COLUMNAS[campo]] = valor;

    const existente = await this.findByFecha(fecha, tx);
    const ahora = new Date().toISOString();

    if (!existente) {
      const [creada] = await tx.crear(TABLA, [
        {
          fecha,
          ...camposDb,
          abierta_por: usuario || null,
          abierta_en: ahora,
          actualizada_por: usuario || null,
          actualizada_en: ahora,
          estado: cerrar ? 'cerrada' : 'abierta',
          ...(cerrar ? { cerrada_por: usuario || null, cerrada_en: ahora } : {})
        }
      ]);
      return creada;
    }

    // Una jornada cerrada NO se toca salvo que se autorice explícitamente la corrección.
    if (existente.estado === 'cerrada' && !permitirCerrada) return null;

    const [actualizada] = await tx.actualizar(TABLA, [
      {
        id: existente.id,
        campos: {
          ...camposDb,
          actualizada_por: usuario || null,
          actualizada_en: ahora,
          ...(cerrar ? { estado: 'cerrada', cerrada_por: usuario || null, cerrada_en: ahora } : {})
        }
      }
    ]);
    return actualizada;
  }

  async listAbiertasHasta(fechaMaxima) {
    return this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{estado}='abierta'`,
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fechaMaxima)}`
      ]),
      orden: [{ campo: 'fecha', direccion: 'asc' }]
    });
  }

  async listByDateRange(inicio, fin) {
    return this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', [
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>=${textoFormula(inicio)}`,
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fin)}`
      ]),
      orden: [{ campo: 'fecha', direccion: 'asc' }]
    });
  }

  // Airtable no agrupa (no hay GROUP BY): se traen todas las jornadas y se
  // suman por año/mes en JavaScript.
  async summarizeByMonth() {
    const filas = await this.cliente.listar(TABLA);
    const grupos = new Map(); // "2026-09" -> { anio, mes, total_surtidor, jornadas }
    for (const fila of filas) {
      const clave = String(fila.fecha || '').slice(0, 7);
      if (!clave) continue;
      const nodo = grupos.get(clave) || {
        anio: Number(clave.slice(0, 4)),
        mes: Number(clave.slice(5, 7)),
        total_surtidor: 0,
        jornadas: 0
      };
      nodo.total_surtidor += Number(fila.total_galones || 0);
      nodo.jornadas += 1;
      grupos.set(clave, nodo);
    }
    return [...grupos.values()];
  }

  async countSuministros(fecha) {
    const filas = await this.cliente.listar(TABLA_REGISTROS, {
      formula: combinarFormula('AND', [fechaFormula('fecha', fecha), `{estado}!='ANULADO'`])
    });
    return filas.length;
  }
}

module.exports = { AirtableJornadaRepository };
