// ============================================================================
// pg-alert.repository.js (INFRAESTRUCTURA) — SQL DE ALERTAS Y NOTIFICACIONES
// ----------------------------------------------------------------------------
// Maneja dos tablas a la vez:
//   alertas_combustible        -> la alerta en sí
//   notificaciones_combustible -> el aviso de esa alerta para cada rol
// Al crear una alerta se generan automáticamente sus notificaciones.
// PARA CAMBIAR LOS TEXTOS DE LAS ALERTAS -> TITULOS_ALERTA y construirMensaje().
// PARA CAMBIAR QUIÉN RECIBE LOS AVISOS -> el arreglo de roles dentro de create().
// ============================================================================

const { AlertRepository } = require('../domain/alert.repository');

// Título corto de cada tipo de alerta (encabezado de la notificación).
const TITULOS_ALERTA = {
  sobrecapacidad: 'Alerta de sobrecapacidad',
  promedio: 'Alerta de consumo superior al promedio',
  horometro_irregular: 'Alerta de horómetro irregular',
  inspeccion_pendiente: 'Alerta de inspección pendiente',
  cierre_pendiente: 'Alerta de cierre pendiente'
};

// Redacta el mensaje explicativo según el tipo de alerta.
function construirMensaje(alerta) {
  switch (alerta.tipoAlerta) {
    case 'promedio':
      // Cuánto cargó vs. su promedio histórico y el porcentaje de exceso.
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones, un ${Number(alerta.porcentajeSobrePromedio).toFixed(1)}% por encima de su promedio histórico de ${Number(alerta.promedioGalones).toFixed(2)} galones.`;
    case 'horometro_irregular':
      // Muestra lo que se escribió y el último horómetro válido conocido.
      return `La máquina ${alerta.maquina} registró una lectura de horómetro irregular: "${alerta.detalle || 'sin valor numérico'}"${alerta.valorReferencia ? `. El último horómetro válido registrado fue ${Number(alerta.valorReferencia).toFixed(2)}.` : '.'}`;
    case 'inspeccion_pendiente':
      // El día se cerró sin llenar el checklist de seguridad.
      return `El cierre del día ${alerta.fecha} se guardó sin diligenciar el checklist de inspección diaria (fuga de biodiésel, sistema eléctrico y parada de emergencia).`;
    case 'cierre_pendiente':
      return `La jornada del ${alerta.fecha} sigue abierta: falta ingresar las lecturas finales de M1/M2 y guardar el cierre del día.`;
    default:
      // Caso por defecto: sobrecapacidad del tanque.
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones y supera su capacidad de ${Number(alerta.capacidadGalones).toFixed(2)} galones.`;
  }
}

class PgAlertRepository extends AlertRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Todas las alertas, de la más reciente a la más antigua.
  async list() {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,jornada_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible ORDER BY fecha DESC,id DESC`
    );
    return rows;
  }

  // Una alerta puntual (se usa al descargar su archivo de soporte).
  async findById(id) {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,jornada_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible WHERE id=? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  // ¿Este registro ya generó una alerta de este tipo? (evita duplicados).
  async findByRegistro(registroId, tipo = 'sobrecapacidad', connection = this.db) {
    const [rows] = await connection.query(
      'SELECT * FROM alertas_combustible WHERE registro_id=? AND tipo_alerta=? LIMIT 1',
      [registroId, tipo]
    );
    return rows[0] || null;
  }

  // ¿Esta jornada ya generó una alerta de este tipo? (checklist / cierre pendiente).
  async findByJornada(jornadaId, tipo, connection = this.db) {
    const [rows] = await connection.query(
      'SELECT * FROM alertas_combustible WHERE jornada_id=? AND tipo_alerta=? LIMIT 1',
      [jornadaId, tipo]
    );
    return rows[0] || null;
  }

  // Cuando la jornada se cierra, sus alertas de "cierre pendiente" quedan
  // resueltas solas (y se marcan como leídas sus notificaciones).
  async resolverPorJornada(jornadaId, tipo, usuario, connection = this.db) {
    const [resueltas] = await connection.query(
      `UPDATE alertas_combustible SET estado='justificada',justificacion=COALESCE(justificacion,'Jornada cerrada.'),justificado_por=?,justificado_en=NOW() WHERE jornada_id=? AND tipo_alerta=? AND estado<>'justificada' RETURNING id`,
      [usuario || null, jornadaId, tipo]
    );
    for (const { id } of resueltas)
      await connection.query(
        'UPDATE notificaciones_combustible SET leida=TRUE,leida_en=NOW() WHERE alerta_id=?',
        [id]
      );
    return resueltas.length;
  }

  // "connection" es opcional: se usa la misma conexion en transaccion que el
  // registro que disparo la alerta (ver record.service.js), si se paso una.
  async create(alerta, connection = this.db) {
    const tipoAlerta = alerta.tipoAlerta || 'sobrecapacidad';
    // 1) Se inserta la alerta en estado 'pendiente'.
    const [filasNuevas] = await connection.query(
      `INSERT INTO alertas_combustible(registro_id,jornada_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,estado,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
        alerta.registroId || null,
        alerta.jornadaId || null,
        alerta.fecha || null,
        alerta.maquina || null,
        alerta.operario || null,
        // ?? (en vez de ||) preserva el valor 0, que aquí es un dato válido.
        alerta.cantidad ?? null,
        alerta.capacidadGalones ?? 0,
        alerta.excesoGalones ?? null,
        alerta.observaciones || null,
        'pendiente',
        tipoAlerta,
        alerta.promedioGalones ?? null,
        alerta.porcentajeSobrePromedio ?? null,
        alerta.detalle || null,
        alerta.valorReferencia ?? null
      ]
    );
    const id = filasNuevas[0].id;

    // 2) Se genera una notificación por cada rol que debe enterarse.
    //    ON CONFLICT ... DO UPDATE evita avisos repetidos (clave alerta_id+rol).
    const titulo = TITULOS_ALERTA[tipoAlerta] || TITULOS_ALERTA.sobrecapacidad;
    const mensaje = construirMensaje({ ...alerta, tipoAlerta });
    for (const rol of ['super_administrador', 'supervisor', 'administrador'])
      await connection.query(
        `INSERT INTO notificaciones_combustible(alerta_id,rol,titulo,mensaje) VALUES(?,?,?,?) ON CONFLICT (alerta_id,rol) DO UPDATE SET mensaje=EXCLUDED.mensaje`,
        [id, rol, titulo, mensaje]
      );

    // 3) Se devuelve la alerta ya en formato camelCase para el frontend.
    return {
      id,
      nueva: true, // Se creó ahora (no existía)
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

  // Actualización parcial con lista blanca: solo los campos de la
  // justificación son modificables. Los datos de la alerta original
  // (cantidad, máquina, exceso...) nunca se pueden alterar.
  async update(id, datos) {
    const campos = [];
    const valores = [];
    const columnasPermitidas = {
      justificacion: 'justificacion',
      estado: 'estado',
      justificadoPor: 'justificado_por',
      justificadoEn: 'justificado_en',
      reporteNombre: 'reporte_nombre',
      reporteRuta: 'reporte_ruta',
      reporteTipo: 'reporte_tipo'
    };
    // Solo se incluyen en el UPDATE los campos que realmente llegaron.
    for (const [campo, columna] of Object.entries(columnasPermitidas)) {
      if (datos[campo] !== undefined) {
        campos.push(`${columna}=?`);
        valores.push(datos[campo]);
      }
    }
    if (!campos.length) return false;
    await this.db.query(`UPDATE alertas_combustible SET ${campos.join(',')} WHERE id=?`, [
      ...valores,
      id
    ]);
    return true;
  }

  // Notificaciones de un rol: primero las no leídas, después por fecha.
  // Máximo 50 para no cargar de más la campanita.
  async listNotifications(rol) {
    const [rows] = await this.db.query(
      `SELECT id,alerta_id,titulo,mensaje,leida,creado_en FROM notificaciones_combustible WHERE rol=? ORDER BY leida ASC,creado_en DESC,id DESC LIMIT 50`,
      [rol]
    );
    return rows;
  }

  // Marca como leída una notificación concreta de un rol.
  async markNotification(id, rol) {
    await this.db.query(
      `UPDATE notificaciones_combustible SET leida=TRUE,leida_en=NOW() WHERE id=? AND rol=?`,
      [id, rol]
    );
    return true;
  }

  // Cierra las notificaciones de TODOS los roles cuando la alerta se justifica.
  async markNotificationsForAlert(alertaId) {
    await this.db.query(
      `UPDATE notificaciones_combustible SET leida=TRUE,leida_en=NOW() WHERE alerta_id=?`,
      [alertaId]
    );
    return true;
  }

  // Alertas de un rango de fechas, en orden cronológico (para los reportes).
  async listByDateRange(inicio, fin) {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,jornada_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible WHERE fecha BETWEEN ? AND ? ORDER BY fecha ASC,id ASC`,
      [inicio, fin]
    );
    return rows;
  }
}
module.exports = { PgAlertRepository };
