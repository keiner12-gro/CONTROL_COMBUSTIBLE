// ============================================================================
// pg-jornada.repository.js (INFRAESTRUCTURA) — SQL DE LAS JORNADAS
// ----------------------------------------------------------------------------
// Tabla jornadas_combustible: UNA fila por día con las lecturas del surtidor
// (M1/M2 inicial y final) y el checklist de inspección.
//   estado 'abierta' = borrador guardado, falta el cierre.
//   estado 'cerrada' = cierre definitivo.
// La fecha es UNIQUE en la base: es imposible tener dos cierres el mismo día.
// SI AGREGAS UN CAMPO NUEVO A LA JORNADA: agrégalo a COLUMNAS (abajo), a
// supabase/schema.sql y a domain/jornada.mapper.js.
// ============================================================================

// nombre en el frontend -> columna en la base (lista blanca de lo editable)
const COLUMNAS = {
  m1Inicial: 'm1_inicial',
  m1Final: 'm1_final',
  m2Inicial: 'm2_inicial',
  m2Final: 'm2_final',
  galonesM1: 'galones_m1',
  galonesM2: 'galones_m2',
  totalGalones: 'total_galones',
  fugaBiodiesel: 'fuga_biodiesel',
  sistemaElectrico: 'sistema_electrico',
  paradaEmergencia: 'parada_emergencia'
};

class PgJornadaRepository {
  constructor(db) {
    this.db = db;
  }

  transaction(funcion) {
    return this.db.transaction(funcion);
  }

  async findByFecha(fecha, tx = this.db) {
    const [filas] = await tx.query('SELECT * FROM jornadas_combustible WHERE fecha=?', [fecha]);
    return filas[0] || null;
  }

  async findById(id, tx = this.db) {
    const [filas] = await tx.query('SELECT * FROM jornadas_combustible WHERE id=?', [id]);
    return filas[0] || null;
  }

  // Crea la jornada del día o actualiza SOLO los campos que lleguen en "campos".
  //   campos: { m1Inicial, m1Final, ..., fugaBiodiesel, ... } (undefined = no tocar)
  //   cerrar: true -> además la deja en estado 'cerrada'
  //   permitirCerrada: true -> deja modificar una jornada ya cerrada (corrección
  //                    autorizada); si es false, una jornada cerrada NO se toca.
  // Devuelve la fila resultante, o null si estaba cerrada y no se pudo modificar.
  async guardar(
    fecha,
    campos,
    usuario,
    { cerrar = false, permitirCerrada = false } = {},
    tx = this.db
  ) {
    const entradas = Object.entries(campos || {}).filter(
      ([campo, valor]) => COLUMNAS[campo] && valor !== undefined
    );
    const columnas = entradas.map(([campo]) => COLUMNAS[campo]);
    const valores = entradas.map(([, valor]) => valor);

    // Al INSERTAR (primera vez del día) y al ACTUALIZAR (ON CONFLICT) se usan las mismas columnas.
    const columnasInsert = ['fecha', ...columnas, 'abierta_por', 'actualizada_por'];
    const marcadores = columnasInsert.map(() => '?');
    const parametros = [fecha, ...valores, usuario || null, usuario || null];
    if (cerrar) {
      columnasInsert.push('estado', 'cerrada_por', 'cerrada_en');
      marcadores.push("'cerrada'", '?', 'NOW()');
      parametros.push(usuario || null);
    }

    const sets = columnas.map((columna) => `${columna}=EXCLUDED.${columna}`);
    sets.push('actualizada_por=EXCLUDED.actualizada_por', 'actualizada_en=NOW()');
    if (cerrar)
      sets.push("estado='cerrada'", 'cerrada_por=EXCLUDED.actualizada_por', 'cerrada_en=NOW()');

    // La condición WHERE hace que una jornada cerrada NO se pueda pisar (de forma atómica).
    const [filas] = await tx.query(
      `INSERT INTO jornadas_combustible(${columnasInsert.join(',')}) VALUES(${marcadores.join(',')})
       ON CONFLICT (fecha) DO UPDATE SET ${sets.join(',')}
       ${permitirCerrada ? '' : "WHERE jornadas_combustible.estado='abierta'"}
       RETURNING *`,
      parametros
    );
    return filas[0] || null;
  }

  // Jornadas abiertas (sin cierre) hasta una fecha, de la más antigua a la más nueva.
  async listAbiertasHasta(fechaMaxima) {
    const [filas] = await this.db.query(
      "SELECT * FROM jornadas_combustible WHERE estado='abierta' AND fecha<=? ORDER BY fecha ASC",
      [fechaMaxima]
    );
    return filas;
  }

  // Jornadas de un rango de fechas (reportes).
  async listByDateRange(inicio, fin) {
    const [filas] = await this.db.query(
      'SELECT * FROM jornadas_combustible WHERE fecha BETWEEN ? AND ? ORDER BY fecha ASC',
      [inicio, fin]
    );
    return filas;
  }

  // Galones del surtidor (M1+M2) por año y mes, para los reportes mensuales.
  async summarizeByMonth() {
    const [filas] = await this.db.query(
      `SELECT EXTRACT(YEAR FROM fecha)::int AS anio,EXTRACT(MONTH FROM fecha)::int AS mes,COALESCE(SUM(total_galones),0) AS total_surtidor,COUNT(*)::int AS jornadas FROM jornadas_combustible GROUP BY 1,2`
    );
    return filas;
  }

  // ¿Hubo suministros ese día? (para saber si el día anterior tuvo actividad).
  async countSuministros(fecha) {
    const [filas] = await this.db.query(
      "SELECT COUNT(*)::int AS total FROM registros_combustible WHERE fecha=? AND estado<>'ANULADO'",
      [fecha]
    );
    return Number(filas[0]?.total || 0);
  }
}

module.exports = { PgJornadaRepository, COLUMNAS };
