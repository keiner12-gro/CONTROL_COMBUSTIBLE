// ============================================================================
// record.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE REGISTROS
// ----------------------------------------------------------------------------
// Lista de operaciones que necesita el módulo de registros de combustible.
// Implementación real: infrastructure/mysql-record.repository.js.
// ============================================================================

class RecordRepository {
  async list() {
    // Todos los registros activos
    throw new Error('Not implemented');
  }

  async findById() {
    // Un registro puntual
    throw new Error('Not implemented');
  }

  async insert() {
    // Inserta un registro (carga o cierre de día)
    throw new Error('Not implemented');
  }

  async update() {
    // Edita campos de un registro existente
    throw new Error('Not implemented');
  }

  async remove() {
    // Anulación lógica del registro
    throw new Error('Not implemented');
  }

  async findDailyClosing() {
    // Busca si una fecha ya tiene cierre de día
    throw new Error('Not implemented');
  }

  async hasChecklist() {
    // Indica si el checklist del día ya fue diligenciado
    throw new Error('Not implemented');
  }

  async latestHourmeter() {
    // Último horómetro registrado de una máquina (para validar que no baje)
    throw new Error('Not implemented');
  }

  async findByDateRange() {
    // Registros entre dos fechas (consultas y reportes)
    throw new Error('Not implemented');
  }

  async summarizeByMonth() {
    // Totales agrupados por mes (para los cierres mensuales)
    throw new Error('Not implemented');
  }
}

module.exports = { RecordRepository };
