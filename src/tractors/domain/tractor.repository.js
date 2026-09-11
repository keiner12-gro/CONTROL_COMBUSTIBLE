// ============================================================================
// tractor.repository.js (DOMINIO) — CONTRATO DEL REPOSITORIO DE MAQUINARIA
// ----------------------------------------------------------------------------
// Define las operaciones que debe tener cualquier repositorio de tractores.
// La versión real (SQL) está en infrastructure/mysql-tractor.repository.js.
// ============================================================================

class TractorRepository {
  async list() {
    // Listado de máquinas activas
    throw new Error('Not implemented');
  }

  async create() {
    // Alta de una máquina
    throw new Error('Not implemented');
  }

  async findById() {
    // Consulta por id
    throw new Error('Not implemented');
  }

  async update() {
    // Edición de datos y capacidad
    throw new Error('Not implemented');
  }

  async remove() {
    // Anulación lógica (no borra la fila)
    throw new Error('Not implemented');
  }
}

module.exports = { TractorRepository };
