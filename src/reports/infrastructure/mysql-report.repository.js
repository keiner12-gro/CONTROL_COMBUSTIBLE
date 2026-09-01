const { ReportRepository } = require('../domain/report.repository');

class MySQLReportRepository extends ReportRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async saveSummary(anio, mes, datos) {
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const mesTexto = String(mes).padStart(2, '0');
    const fechaInicio = `${anio}-${mesTexto}-01`;
    const fechaFin = `${anio}-${mesTexto}-${String(ultimoDia).padStart(2, '0')}`;
    const fechaCierre = `${fechaFin} 17:00:00`;
    const estado =
      new Date() >= new Date(anio, mes - 1, ultimoDia, 17, 0, 0) ? 'cerrado' : 'abierto';
    await this.db.query(
      `INSERT INTO reportes_combustible(anio,mes,fecha_inicio,fecha_fin,fecha_cierre,estado,total_registros,total_galones) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fecha_inicio=VALUES(fecha_inicio),fecha_fin=VALUES(fecha_fin),fecha_cierre=VALUES(fecha_cierre),estado=VALUES(estado),total_registros=VALUES(total_registros),total_galones=VALUES(total_galones)`,
      [
        anio,
        mes,
        fechaInicio,
        fechaFin,
        fechaCierre,
        estado,
        datos.totalRegistros,
        datos.totalGalones
      ]
    );
  }

  async removeWithoutRecordsExceptCurrent(anio, mes) {
    await this.db.query(
      `DELETE reporte FROM reportes_combustible reporte LEFT JOIN(SELECT YEAR(fecha) anio,MONTH(fecha) mes FROM registros_combustible WHERE fecha IS NOT NULL GROUP BY YEAR(fecha),MONTH(fecha)) resumen ON resumen.anio=reporte.anio AND resumen.mes=reporte.mes WHERE resumen.anio IS NULL AND NOT(reporte.anio=? AND reporte.mes=?)`,
      [anio, mes]
    );
  }

  async list() {
    const [filas] = await this.db.query(
      `SELECT id,anio,mes,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fechaFin,DATE_FORMAT(fecha_cierre,'%Y-%m-%d %H:%i:%s') fechaCierre,estado,total_registros totalRegistros,total_galones totalGalones FROM reportes_combustible ORDER BY anio DESC,mes DESC`
    );
    return filas;
  }
}

module.exports = { MySQLReportRepository };
