// ============================================================================
// pg-tractor.repository.js (INFRAESTRUCTURA) — SQL DE MAQUINARIA
// ----------------------------------------------------------------------------
// Consultas a la tabla "tractores". Detalle importante: los textos se guardan
// SIEMPRE EN MAYÚSCULAS para que las búsquedas y comparaciones con los
// registros históricos coincidan.
// ============================================================================

const { TractorRepository } = require('../domain/tractor.repository');

class PgTractorRepository extends TractorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Listado para las pantallas y los selectores: excluye las máquinas anuladas
  // y ordena por número de ítem.
  async list() {
    const [filas] = await this.db.query(
      "SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE estado<>'ANULADO' ORDER BY item ASC,maquina ASC"
    );
    return filas;
  }

  // Trae la fila completa (incluye estado y datos de anulación).
  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM tractores WHERE id=?', [id]);
    return filas[0] || null;
  }

  // Busca por el código de máquina sin distinguir mayúsculas.
  // Lo usa record.service.js para obtener la capacidad del tanque al validar
  // una carga y decidir si genera alerta de sobrecapacidad.
  async findByMachine(maquina) {
    const [filas] = await this.db.query(
      'SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE UPPER(maquina)=UPPER(?) LIMIT 1',
      [maquina || '']
    );
    return filas[0] || null;
  }

  // Alta: el número de "item" se calcula solo como el máximo actual + 1.
  async create(datos) {
    const [[siguiente]] = await this.db.query(
      'SELECT COALESCE(MAX(item),0)+1 AS siguiente_item FROM tractores' // COALESCE cubre la tabla vacía
    );
    const item = Number(siguiente.siguiente_item);
    // Normalización: sin espacios sobrantes y en mayúsculas.
    const maquina = String(datos.maquina || '')
      .trim()
      .toUpperCase();
    const descripcion = String(datos.descripcion || '')
      .trim()
      .toUpperCase();
    const centro_costo = String(datos.centro_costo || '')
      .trim()
      .toUpperCase();
    const capacidad_galones = Number(datos.capacidad_galones || 0); // Base para las alertas
    const [filasNuevas] = await this.db.query(
      'INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?) RETURNING id',
      [item, maquina, descripcion, centro_costo, capacidad_galones]
    );
    // Se devuelve el objeto completo para que la pantalla lo pinte sin recargar.
    return { id: filasNuevas[0].id, item, maquina, descripcion, centro_costo, capacidad_galones };
  }

  // Edición: misma normalización que en create. El "item" no se modifica.
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
    const [, resultado] = await this.db.query(
      'UPDATE tractores SET maquina=?,descripcion=?,centro_costo=?,capacidad_galones=? WHERE id=?',
      [maquina, descripcion, centro_costo, capacidad_galones, id]
    );
    if (!resultado.rowCount) return null; // No existía ese id
    // Se relee la fila para devolver el dato tal como quedó guardado.
    const [filas] = await this.db.query(
      'SELECT id,item,maquina,descripcion,centro_costo,capacidad_galones FROM tractores WHERE id=?',
      [id]
    );
    return filas[0] || null;
  }

  // Anula en vez de borrar: los registros historicos ya guardaron el nombre
  // de la maquina y no deben quedar huerfanos.
  async remove(id, motivo, usuario) {
    const [, resultado] = await this.db.query(
      // La condición estado<>'ANULADO' evita pisar los datos de una anulación previa.
      "UPDATE tractores SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.rowCount > 0; // true si realmente se anuló algo
  }
}

module.exports = { PgTractorRepository };
