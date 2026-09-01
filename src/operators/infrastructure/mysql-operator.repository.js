const { OperatorRepository } = require('../domain/operator.repository');

class MySQLOperatorRepository extends OperatorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async list() {
    const [filas] = await this.db.query(
      'SELECT id,nombre,cedula FROM operarios ORDER BY nombre ASC'
    );
    return filas;
  }

  async create(datos) {
    const nombre = String(datos.nombre || '')
      .trim()
      .toUpperCase();
    const cedula = String(datos.cedula || '').trim();
    const [resultado] = await this.db.query('INSERT INTO operarios(nombre,cedula) VALUES(?,?)', [
      nombre,
      cedula
    ]);
    return { id: resultado.insertId, nombre, cedula };
  }

  async remove(id) {
    await this.db.query('DELETE FROM operarios WHERE id=?', [id]);
  }
}

module.exports = { MySQLOperatorRepository };
