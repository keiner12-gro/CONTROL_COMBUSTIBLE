// ============================================================================
// report.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE REPORTES
// ----------------------------------------------------------------------------
// Los "reportes" son los resúmenes mensuales (un registro por año/mes).
// ============================================================================

class ReportRepository {
  async list() {
    // Listado de resúmenes mensuales
    throw new Error('Not implemented');
  }
  async saveSummary() {
    // Crea o actualiza el resumen de un mes
    throw new Error('Not implemented');
  }
  async removeWithoutRecordsExceptCurrent() {
    // Limpia meses que quedaron sin registros
    throw new Error('Not implemented');
  }
}
module.exports = { ReportRepository };
