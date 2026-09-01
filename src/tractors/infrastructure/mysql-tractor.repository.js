const { TractorRepository } = require('../domain/tractor.repository');

class MySQLTractorRepository extends TractorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async list() {
    const [filas] = await this.db.query(
      "SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE estado<>'ANULADO' ORDER BY item ASC,maquina ASC"
    );
    return filas;
  }

  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM tractores WHERE id=?', [id]);
    return filas[0] || null;
  }

  async findByMachine(maquina) {
    const [filas] = await this.db.query(
      'SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE UPPER(maquina)=UPPER(?) LIMIT 1',
      [maquina || '']
    );
    return filas[0] || null;
  }

  async create(datos) {
    const [[siguiente]] = await this.db.query(
      'SELECT COALESCE(MAX(item),0)+1 AS siguiente_item FROM tractores'
    );
    const item = Number(siguiente.siguiente_item);
    const maquina = String(datos.maquina || '')
      .trim()
      .toUpperCase();
    const descripcion = String(datos.descripcion || '')
      .trim()
      .toUpperCase();
    const centro_costo = String(datos.centro_costo || '')
      .trim()
      .toUpperCase();
    const capacidad_galones = Number(datos.capacidad_galones || 0);
    const [resultado] = await this.db.query(
      'INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?)',
      [item, maquina, descripcion, centro_costo, capacidad_galones]
    );
    return { id: resultado.insertId, item, maquina, descripcion, centro_costo, capacidad_galones };
  }

  async update(id, datos) {
    const maquina = String(datos.maquina || '')
      .trim()
      .toUpperCase();
    const descripcion = String(datos.descripcion || '')
      .trim()
      .toUpperCase();
    const centro_costo = String(datos.centro_costo || '')
      .trim()
      .toUpperCase();
    const capacidad_galones = Number(datos.capacidad_galones || 0);
    const [resultado] = await this.db.query(
      'UPDATE tractores SET maquina=?,descripcion=?,centro_costo=?,capacidad_galones=? WHERE id=?',
      [maquina, descripcion, centro_costo, capacidad_galones, id]
    );
    if (!resultado.affectedRows) return null;
    const [filas] = await this.db.query(
      'SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE id=?',
      [id]
    );
    return filas[0] || null;
  }

  // Anula en vez de borrar: los registros historicos ya guardaron el nombre
  // de la maquina y no deben quedar huerfanos.
  async remove(id, motivo, usuario) {
    const [resultado] = await this.db.query(
      "UPDATE tractores SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.affectedRows > 0;
  }
}

module.exports = { MySQLTractorRepository };
