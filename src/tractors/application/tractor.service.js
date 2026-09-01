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

  update(id, datos) {
    return this.repository.update(id, datos);
  }

  remove(id) {
    return this.repository.remove(id);
  }
}

module.exports = { TractorService };
