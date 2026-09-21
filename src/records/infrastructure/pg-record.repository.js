// ============================================================================
// pg-record.repository.js (INFRAESTRUCTURA) — SQL DE LOS SUMINISTROS
// ----------------------------------------------------------------------------
// Tabla registros_combustible: un suministro de combustible a una máquina.
// Los medidores M1/M2 y el checklist NO viven aquí: están en la tabla
// jornadas_combustible (ver src/jornadas/).
// Regla general: ningún listado muestra registros con estado 'ANULADO'.
// ============================================================================

const { RecordRepository } = require('../domain/record.repository');

class PgRecordRepository extends RecordRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Ejecuta varias operaciones como una sola unidad (todo o nada), p. ej.
  // guardar el suministro junto con sus alertas y la jornada del día.
  transaction(funcion) {
    return this.db.transaction(funcion);
  }

  // Todos los suministros vigentes, del más nuevo al más viejo.
  async list() {
    const [filas] = await this.db.query(
      "SELECT * FROM registros_combustible WHERE estado<>'ANULADO' ORDER BY id DESC"
    );
    return filas;
  }

  // Un registro por id (incluye los anulados: se usa para validar y auditar).
  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM registros_combustible WHERE id=?', [id]);
    return filas[0] || null;
  }

  // "tx" es opcional: si se pasa una transacción abierta se usa esa.
  async insert(datos, tx = this.db) {
    const [filas] = await tx.query(
      `INSERT INTO registros_combustible(fecha,operario,cedula,maquina,horometro,cantidad,numero_sai,firma,observaciones,registrado_por) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
        datos.fecha,
        datos.operario || null, // "|| null" evita guardar cadenas vacías
        datos.cedula || null,
        datos.maquina || null,
        datos.horometro || null,
        datos.cantidad || null,
        datos.numeroSai || null,
        datos.firma || null,
        datos.observaciones || null,
        datos.registradoPor || null
      ]
    );
    return filas[0].id;
  }

  // Galones por máquina en un rango de fechas (gráfica de análisis y ranking).
  // El LEFT JOIN con tractores trae la capacidad y descripción de cada equipo.
  async machineConsumptionStats(inicio, fin) {
    const [filas] = await this.db.query(
      `SELECT r.maquina,COUNT(*) AS registros,COALESCE(SUM(r.cantidad),0) AS total_galones,COALESCE(AVG(r.cantidad),0) AS promedio_galones,COALESCE(MAX(r.cantidad),0) AS maximo_galones,COALESCE(t.capacidad_galones,0) AS capacidad_galones,t.descripcion AS descripcion FROM registros_combustible r LEFT JOIN tractores t ON UPPER(t.maquina)=UPPER(r.maquina) WHERE r.estado<>'ANULADO' AND r.fecha BETWEEN ? AND ? AND r.cantidad IS NOT NULL AND r.cantidad>0 GROUP BY r.maquina,t.capacidad_galones,t.descripcion ORDER BY total_galones DESC`,
      [inicio, fin]
    );
    return filas.map((fila) => ({
      ...fila,
      registros: Number(fila.registros),
      totalGalones: Number(fila.total_galones),
      promedioGalones: Number(fila.promedio_galones),
      maximoGalones: Number(fila.maximo_galones),
      capacidadGalones: Number(fila.capacidad_galones),
      descripcion: fila.descripcion || null
    }));
  }

  // Promedio histórico de galones por carga de una máquina (alerta de promedio).
  // idExcluido permite ignorar el suministro que se acaba de insertar.
  async averageQuantityByMachine(maquina, idExcluido = null, tx = this.db) {
    const condiciones = [
      "estado<>'ANULADO'",
      'cantidad IS NOT NULL',
      'cantidad>0',
      'UPPER(maquina)=UPPER(?)'
    ];
    const valores = [maquina || ''];
    if (idExcluido) {
      condiciones.push('id<>?');
      valores.push(idExcluido);
    }
    const [filas] = await tx.query(
      `SELECT COUNT(*) AS muestras,COALESCE(AVG(cantidad),0) AS promedio FROM registros_combustible WHERE ${condiciones.join(' AND ')}`,
      valores
    );
    return { muestras: Number(filas[0]?.muestras || 0), promedio: Number(filas[0]?.promedio || 0) };
  }

  // Último horómetro numérico válido de una máquina (no puede retroceder).
  async latestHourmeter(maquina, tx = this.db) {
    const [filas] = await tx.query(
      `SELECT MAX(REPLACE(horometro,',','.')::numeric) AS ultimo_horometro FROM registros_combustible WHERE maquina=? AND estado<>'ANULADO' AND horometro ~ '^[0-9]+([,.][0-9]+)?$'`,
      [maquina || '']
    );
    return Number(filas[0]?.ultimo_horometro) || 0;
  }

  // Suministros de un rango de fechas, con búsqueda opcional por máquina/operario.
  async findByDateRange(inicio, fin, busqueda = '') {
    const condiciones = ['fecha BETWEEN ? AND ?', "estado<>'ANULADO'"];
    const valores = [inicio, fin];
    if (busqueda) {
      condiciones.push('(maquina ILIKE ? OR operario ILIKE ?)');
      valores.push(`%${busqueda}%`, `%${busqueda}%`); // % = comodín de LIKE
    }
    const [filas] = await this.db.query(
      `SELECT * FROM registros_combustible WHERE ${condiciones.join(' AND ')} ORDER BY fecha ASC,id ASC`,
      valores
    );
    return filas;
  }

  // Edita solo los campos permitidos (lista blanca: nada más se puede tocar).
  async update(id, cambios) {
    const columnasPermitidas = {
      operario: 'operario', // nombre en el frontend -> columna en la base
      cedula: 'cedula',
      maquina: 'maquina',
      horometro: 'horometro',
      cantidad: 'cantidad',
      numeroSai: 'numero_sai',
      observaciones: 'observaciones'
    };
    const entradas = Object.entries(cambios).filter(([campo]) => columnasPermitidas[campo]);
    if (!entradas.length) return false; // Nada válido que actualizar
    await this.db.query(
      `UPDATE registros_combustible SET ${entradas.map(([campo]) => `${columnasPermitidas[campo]}=?`).join(',')} WHERE id=?`,
      [
        ...entradas.map(([campo, valor]) =>
          ['operario', 'maquina', 'numeroSai'].includes(campo)
            ? String(valor || '')
                .trim()
                .toUpperCase()
            : valor === ''
              ? null
              : valor
        ),
        id
      ]
    );
    return true;
  }

  // Anula el registro en vez de borrarlo físicamente: conserva el dato
  // histórico y deja quién/cuándo/por qué se anuló.
  async remove(id, motivo, usuario) {
    const [, resultado] = await this.db.query(
      "UPDATE registros_combustible SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.rowCount > 0;
  }

  // Número de suministros por año y mes (lo usan los reportes mensuales).
  async summarizeByMonth() {
    const [filas] = await this.db.query(
      `SELECT EXTRACT(YEAR FROM fecha)::int AS anio,EXTRACT(MONTH FROM fecha)::int AS mes,COUNT(*)::int AS total_registros,COALESCE(SUM(cantidad),0) AS total_suministrado FROM registros_combustible WHERE estado<>'ANULADO' GROUP BY 1,2`
    );
    return filas;
  }
}

module.exports = { PgRecordRepository };
