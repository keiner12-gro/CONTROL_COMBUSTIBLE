// ============================================================================
// mysql-report.repository.js (INFRAESTRUCTURA) — SQL DE REPORTES MENSUALES
// ----------------------------------------------------------------------------
// Tabla reportes_combustible: una fila por año/mes con sus totales.
// ============================================================================

const { ReportRepository } = require('../domain/report.repository');

class MySQLReportRepository extends ReportRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Crea el resumen del mes o lo actualiza si ya existía.
  async saveSummary(anio, mes, datos) {
    // Truco de JavaScript: el día 0 del mes siguiente = último día de este mes.
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const mesTexto = String(mes).padStart(2, '0'); // 3 -> "03"
    const fechaInicio = `${anio}-${mesTexto}-01`;
    const fechaFin = `${anio}-${mesTexto}-${String(ultimoDia).padStart(2, '0')}`;
    // REGLA DE CIERRE: el mes se considera cerrado a las 5:00 p. m. del último
    // día. Para cambiar esa hora se modifican estas dos líneas.
    const fechaCierre = `${fechaFin} 17:00:00`;
    const estado =
      new Date() >= new Date(anio, mes - 1, ultimoDia, 17, 0, 0) ? 'cerrado' : 'abierto';

    // ON DUPLICATE KEY UPDATE: gracias a la clave única (anio,mes), si el mes
    // ya existe se actualiza en vez de fallar por duplicado.
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

  // Borra los reportes de meses que ya no tienen registros asociados
  // (por ejemplo, si se anularon todos), excepto el mes que se pase por
  // parámetro, que normalmente es el mes en curso.
  async removeWithoutRecordsExceptCurrent(anio, mes) {
    await this.db.query(
      // LEFT JOIN + "resumen.anio IS NULL" = meses del reporte que no aparecen
      // en los registros reales.
      `DELETE reporte FROM reportes_combustible reporte LEFT JOIN(SELECT YEAR(fecha) anio,MONTH(fecha) mes FROM registros_combustible WHERE fecha IS NOT NULL GROUP BY YEAR(fecha),MONTH(fecha)) resumen ON resumen.anio=reporte.anio AND resumen.mes=reporte.mes WHERE resumen.anio IS NULL AND NOT(reporte.anio=? AND reporte.mes=?)`,
      [anio, mes]
    );
  }

  // Listado para la pantalla de reportes, del mes más reciente al más antiguo.
  // DATE_FORMAT deja las fechas listas para mostrar y los alias (fechaInicio,
  // totalGalones...) evitan tener que traducir los nombres en el frontend.
  async list() {
    const [filas] = await this.db.query(
      `SELECT id,anio,mes,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fechaFin,DATE_FORMAT(fecha_cierre,'%Y-%m-%d %H:%i:%s') fechaCierre,estado,total_registros totalRegistros,total_galones totalGalones FROM reportes_combustible ORDER BY anio DESC,mes DESC`
    );
    return filas;
  }
}

module.exports = { MySQLReportRepository };
