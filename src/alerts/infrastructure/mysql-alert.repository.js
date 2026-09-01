const { AlertRepository } = require('../domain/alert.repository');

const TITULOS_ALERTA = {
  sobrecapacidad: 'Alerta de sobrecapacidad',
  promedio: 'Alerta de consumo superior al promedio',
  horometro_irregular: 'Alerta de horómetro irregular',
  inspeccion_pendiente: 'Alerta de inspección pendiente'
};

function construirMensaje(alerta) {
  switch (alerta.tipoAlerta) {
    case 'promedio':
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones, un ${Number(alerta.porcentajeSobrePromedio).toFixed(1)}% por encima de su promedio histórico de ${Number(alerta.promedioGalones).toFixed(2)} galones.`;
    case 'horometro_irregular':
      return `La máquina ${alerta.maquina} registró una lectura de horómetro irregular: "${alerta.detalle || 'sin valor numérico'}"${alerta.valorReferencia ? `. El último horómetro válido registrado fue ${Number(alerta.valorReferencia).toFixed(2)}.` : '.'}`;
    case 'inspeccion_pendiente':
      return `El cierre del día ${alerta.fecha} se guardó sin diligenciar el checklist de inspección diaria (fuga de biodiésel, sistema eléctrico y parada de emergencia).`;
    default:
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones y supera su capacidad de ${Number(alerta.capacidadGalones).toFixed(2)} galones.`;
  }
}

class MySQLAlertRepository extends AlertRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async list() {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible ORDER BY fecha DESC,id DESC`
    );
    return rows;
  }

  async findById(id) {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible WHERE id=? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async findByRegistro(registroId, tipo = 'sobrecapacidad', connection = this.db) {
    const [rows] = await connection.query(
      'SELECT * FROM alertas_combustible WHERE registro_id=? AND tipo_alerta=? LIMIT 1',
      [registroId, tipo]
    );
    return rows[0] || null;
  }

  // "connection" es opcional: se usa la misma conexion en transaccion que el
  // registro que disparo la alerta (ver record.service.js), si se paso una.
  async create(alerta, connection = this.db) {
    const tipoAlerta = alerta.tipoAlerta || 'sobrecapacidad';
    const [result] = await connection.query(
      `INSERT INTO alertas_combustible(registro_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,estado,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        alerta.registroId || null,
        alerta.fecha || null,
        alerta.maquina || null,
        alerta.operario || null,
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
    const id = result.insertId;
    const titulo = TITULOS_ALERTA[tipoAlerta] || TITULOS_ALERTA.sobrecapacidad;
    const mensaje = construirMensaje({ ...alerta, tipoAlerta });
    for (const rol of ['super_administrador', 'supervisor', 'administrador'])
      await connection.query(
        `INSERT INTO notificaciones_combustible(alerta_id,rol,titulo,mensaje) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE mensaje=VALUES(mensaje)`,
        [id, rol, titulo, mensaje]
      );
    return {
      id,
      registroId: alerta.registroId,
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

  async listNotifications(rol) {
    const [rows] = await this.db.query(
      `SELECT id,alerta_id,titulo,mensaje,leida,creado_en FROM notificaciones_combustible WHERE rol=? ORDER BY leida ASC,creado_en DESC,id DESC LIMIT 50`,
      [rol]
    );
    return rows;
  }

  async markNotification(id, rol) {
    await this.db.query(
      `UPDATE notificaciones_combustible SET leida=1,leida_en=NOW() WHERE id=? AND rol=?`,
      [id, rol]
    );
    return true;
  }

  async markNotificationsForAlert(alertaId) {
    await this.db.query(
      `UPDATE notificaciones_combustible SET leida=1,leida_en=NOW() WHERE alerta_id=?`,
      [alertaId]
    );
    return true;
  }

  async listByDateRange(inicio, fin) {
    const [rows] = await this.db.query(
      `SELECT id,registro_id,fecha,maquina,operario,cantidad,capacidad_galones,exceso_galones,observaciones,justificacion,estado,justificado_por,justificado_en,reporte_nombre,reporte_ruta,reporte_tipo,tipo_alerta,promedio_galones,porcentaje_sobre_promedio,detalle_alerta,valor_referencia,creado_en FROM alertas_combustible WHERE fecha BETWEEN ? AND ? ORDER BY fecha ASC,id ASC`,
      [inicio, fin]
    );
    return rows;
  }
}
module.exports = { MySQLAlertRepository };
