// ============================================================================
// alert.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE ALERTAS
// ----------------------------------------------------------------------------
// Operaciones mínimas de alertas. La implementación real añade además el
// manejo de notificaciones (campanita) y búsquedas por rango de fechas.
// ============================================================================

class AlertRepository {
  async list() {
    // Todas las alertas
    throw new Error('Not implemented');
  }
  async findById() {
    // Una alerta puntual
    throw new Error('Not implemented');
  }
  async create() {
    // Crea la alerta y sus notificaciones
    throw new Error('Not implemented');
  }
  async update() {
    // Guarda la justificación y el soporte
    throw new Error('Not implemented');
  }
}

module.exports = { AlertRepository };
