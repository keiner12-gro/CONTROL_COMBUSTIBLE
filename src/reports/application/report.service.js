class ReportService {
  constructor(reportRepository, recordRepository) {
    this.reports = reportRepository;
    this.records = recordRepository;
  }

  async generate() {
    const resumenes = await this.records.summarizeByMonth();
    for (const resumen of resumenes)
      await this.reports.saveSummary(resumen.anio, resumen.mes, resumen);

    const hoy = new Date();
    const anioActual = hoy.getFullYear();
    const mesActual = hoy.getMonth() + 1;
    await this.reports.removeWithoutRecordsExceptCurrent(anioActual, mesActual);
    if (
      !resumenes.some(
        (resumen) => Number(resumen.anio) === anioActual && Number(resumen.mes) === mesActual
      )
    )
      await this.reports.saveSummary(anioActual, mesActual, { totalRegistros: 0, totalGalones: 0 });
  }

  async list() {
    await this.generate();
    return this.reports.list();
  }

  listGeneral(inicio, fin, busqueda) {
    return this.records.findByDateRange(inicio, fin, busqueda);
  }
}

module.exports = { ReportService };
