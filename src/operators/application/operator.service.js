// ============================================================================
// operator.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE OPERARIOS
// ----------------------------------------------------------------------------
// Igual que el de tractores: lo único con lógica propia es la anulación.
// ============================================================================

class OperatorService {
  constructor(repository) {
    this.repository = repository;
  }

  // Operarios activos (para la pantalla y para el selector del registro).
  list() {
    return this.repository.list();
  }

  // Alta de operario (nombre + cédula).
  create(data) {
    return this.repository.create(data);
  }

  // Consulta por id.
  findById(id) {
    return this.repository.findById(id);
  }

  // ANULAR un operario: exige motivo, que exista y que no esté ya anulado.
  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio)
      throw Object.assign(new Error('El motivo de anulación es obligatorio.'), { status: 400 });
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El operario no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO')
      throw Object.assign(new Error('Este operario ya está anulado.'), { status: 400 });
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual; // Estado previo, para dejarlo en la auditoría
  }
}

module.exports = { OperatorService };
