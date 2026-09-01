class TractorService {
  constructor(repository) {
    this.repository = repository;
  }

  list() {
    return this.repository.list();
  }

  create(datos) {
    return this.repository.create(datos);
  }

  findById(id) {
    return this.repository.findById(id);
  }

  update(id, datos) {
    return this.repository.update(id, datos);
  }

  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio)
      throw Object.assign(new Error('El motivo de anulación es obligatorio.'), { status: 400 });
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('La máquina no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO')
      throw Object.assign(new Error('Esta máquina ya está anulada.'), { status: 400 });
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual;
  }
}

module.exports = { TractorService };
