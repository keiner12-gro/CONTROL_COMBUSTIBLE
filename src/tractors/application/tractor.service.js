// ============================================================================
// tractor.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE MAQUINARIA
// ----------------------------------------------------------------------------
// Casi todo delega directo en el repositorio; la lógica importante está en
// remove(), que implementa la ANULACIÓN (nunca se borra una máquina).
// ============================================================================

class TractorService {
  constructor(repository) {
    this.repository = repository; // MySQLTractorRepository inyectado desde server.js
  }

  // Máquinas activas (las anuladas no aparecen).
  list() {
    return this.repository.list();
  }

  // Alta de máquina.
  create(datos) {
    return this.repository.create(datos);
  }

  // Consulta por id (incluye anuladas: se usa para auditoría y validaciones).
  findById(id) {
    return this.repository.findById(id);
  }

  // Edición de datos/capacidad.
  update(id, datos) {
    return this.repository.update(id, datos);
  }

  // ANULAR una máquina. Tres validaciones antes de tocar la base:
  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    // 1. El motivo es obligatorio (queda en la auditoría).
    if (!motivoLimpio)
      throw Object.assign(new Error('El motivo de anulación es obligatorio.'), { status: 400 });
    const actual = await this.repository.findById(id);
    // 2. La máquina debe existir.
    if (!actual) throw Object.assign(new Error('La máquina no existe.'), { status: 404 });
    // 3. No se puede anular dos veces.
    if (actual.estado === 'ANULADO')
      throw Object.assign(new Error('Esta máquina ya está anulada.'), { status: 400 });
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual; // Se devuelve el estado previo para registrarlo en la auditoría
  }
}

module.exports = { TractorService };
