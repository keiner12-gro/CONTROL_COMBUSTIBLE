const { OperatorRepository } = require('../domain/operator.repository');

class MySQLOperatorRepository extends OperatorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async list() {
    const [filas] = await this.db.query(
      "SELECT id,nombre,cedula FROM operarios WHERE estado<>'ANULADO' ORDER BY nombre ASC"
    );
    return filas;
  }

  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM operarios WHERE id=?', [id]);
    return filas[0] || null;
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

  // Anula en vez de borrar: conserva el operario para los registros historicos
  // que ya lo referencian por nombre/cedula.
  async remove(id, motivo, usuario) {
    const [resultado] = await this.db.query(
      "UPDATE operarios SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.affectedRows > 0;
  }
}

module.exports = { MySQLOperatorRepository };
