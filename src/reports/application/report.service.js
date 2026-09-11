// ============================================================================
// report.service.js (APLICACIÓN) — LÓGICA DE LOS REPORTES MENSUALES
// ----------------------------------------------------------------------------
// Los reportes NO se crean a mano: se regeneran solos a partir de los
// registros existentes cada vez que se consulta la lista o se cierra un día.
// ============================================================================

class ReportService {
  // Necesita dos repositorios: el de reportes (donde escribe) y el de
  // registros (de donde saca los totales).
  constructor(reportRepository, recordRepository) {
    this.reports = reportRepository;
    this.records = recordRepository;
  }

  // Recalcula todos los resúmenes mensuales.
  async generate() {
    // 1) Totales reales por año/mes sacados de los registros.
    const resumenes = await this.records.summarizeByMonth();
    for (const resumen of resumenes)
      await this.reports.saveSummary(resumen.anio, resumen.mes, resumen);

    const hoy = new Date();
    const anioActual = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1; // getMonth() devuelve 0-11, por eso el +1

    // 2) Borra reportes de meses que ya no tienen ningún registro, salvo el mes
    //    en curso (que debe verse aunque todavía esté vacío).
    await this.reports.removeWithoutRecordsExceptCurrent(anioActual, mesActual);

    // 3) Si el mes actual aún no tiene registros, se crea igual en ceros para
    //    que aparezca en la pantalla de reportes.
    if (
      !resumenes.some(
        (resumen) => Number(resumen.anio) === anioActual && Number(resumen.mes) === mesActual
      )
    )
      await this.reports.saveSummary(anioActual, mesActual, { totalRegistros: 0, totalGalones: 0 });
  }

  // Listar siempre regenera primero: así los totales nunca quedan desfasados.
  async list() {
    await this.generate();
    return this.reports.list();
  }

  // Registros crudos de un rango de fechas (los usa el detalle del reporte y
  // la exportación a Excel/PDF).
  listGeneral(inicio, fin, busqueda) {
    return this.records.findByDateRange(inicio, fin, busqueda);
  }
}

module.exports = { ReportService };
