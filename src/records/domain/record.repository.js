// ============================================================================
// record.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE SUMINISTROS
// ----------------------------------------------------------------------------
// Lista de operaciones que necesita el módulo de registros de combustible.
// Implementación real: infrastructure/pg-record.repository.js.
// (Las lecturas M1/M2 y el checklist se manejan en el módulo src/jornadas/.)
// ============================================================================

const pendiente = () => {
  throw new Error('Not implemented');
};

class RecordRepository {
  async list() {
    return pendiente(); // Todos los suministros activos
  }

  async findById() {
    return pendiente(); // Un suministro por id (incluye anulados)
  }

  async insert() {
    return pendiente(); // Guarda un suministro y devuelve su id
  }

  async update() {
    return pendiente(); // Edita los campos permitidos
  }

  async remove() {
    return pendiente(); // Anula (no borra) un suministro
  }

  async latestHourmeter() {
    return pendiente(); // Último horómetro de una máquina (para validar que no baje)
  }

  async averageQuantityByMachine() {
    return pendiente(); // Promedio histórico de una máquina (alerta de promedio)
  }

  async findByDateRange() {
    return pendiente(); // Suministros entre dos fechas (consultas y reportes)
  }

  async summarizeByMonth() {
    return pendiente(); // Totales agrupados por mes (reportes mensuales)
  }
}

module.exports = { RecordRepository };
