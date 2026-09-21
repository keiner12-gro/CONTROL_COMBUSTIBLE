// ============================================================================
// pg-operator.repository.js (INFRAESTRUCTURA) — SQL DE OPERARIOS
// ----------------------------------------------------------------------------
// Consultas sobre la tabla "operarios".
// ============================================================================

const { OperatorRepository } = require('../domain/operator.repository');

class PgOperatorRepository extends OperatorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Solo operarios activos, ordenados alfabéticamente para el selector.
  async list() {
    const [filas] = await this.db.query(
      "SELECT id,nombre,cedula FROM operarios WHERE estado<>'ANULADO' ORDER BY nombre ASC"
    );
    return filas;
  }

  // Fila completa, incluidos estado y datos de anulación.
  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM operarios WHERE id=?', [id]);
    return filas[0] || null;
  }

  // Alta: el nombre se guarda en mayúsculas para que coincida con lo que se
  // almacena en los registros de combustible.
  async create(datos) {
    const nombre = String(datos.nombre || '')
      .trim()
      .toUpperCase();
    const cedula = String(datos.cedula || '').trim();
    const [filas] = await this.db.query(
      'INSERT INTO operarios(nombre,cedula) VALUES(?,?) RETURNING id',
      [nombre, cedula]
    );
    return { id: filas[0].id, nombre, cedula };
  }

  // Anula en vez de borrar: conserva el operario para los registros historicos
  // que ya lo referencian por nombre/cedula.
  async remove(id, motivo, usuario) {
    const [, resultado] = await this.db.query(
      "UPDATE operarios SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.rowCount > 0;
  }
}

module.exports = { PgOperatorRepository };
