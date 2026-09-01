class OperatorService {
  constructor(repository) {
    this.repository = repository;
  }

  list() {
    return this.repository.list();
  }

  create(data) {
    return this.repository.create(data);
  }

  findById(id) {
    return this.repository.findById(id);
  }

  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio)
      throw Object.assign(new Error('El motivo de anulación es obligatorio.'), { status: 400 });
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El operario no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO')
      throw Object.assign(new Error('Este operario ya está anulado.'), { status: 400 });
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual;
  }
}

module.exports = { OperatorService };
