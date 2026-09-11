// ============================================================================
// operator.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE OPERARIOS
// ----------------------------------------------------------------------------
// Operaciones mínimas del módulo de operarios. Nota: no hay update() porque en
// la pantalla actual un operario solo se crea o se anula.
// ============================================================================

class OperatorRepository {
  async list() {
    // Operarios activos
    throw new Error('Not implemented');
  }

  async create() {
    // Alta de operario
    throw new Error('Not implemented');
  }

  async findById() {
    // Consulta por id
    throw new Error('Not implemented');
  }

  async remove() {
    // Anulación lógica
    throw new Error('Not implemented');
  }
}

module.exports = { OperatorRepository };
