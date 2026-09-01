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

  remove(id) {
    return this.repository.remove(id);
  }
}

module.exports = { OperatorService };
