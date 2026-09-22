// ============================================================================
// pg-audit.repository.js (INFRAESTRUCTURA) — BITÁCORA EN POSTGRES
// ----------------------------------------------------------------------------
// Extracción del SQL que antes vivía dentro de auditoria.routes.js y audit.js,
// sin cambiar ninguna consulta. Mismo contrato que airtable-audit.repository.js.
// ============================================================================

const { AuditRepository } = require('../domain/audit.repository');
const { zona } = require('../application/fechas');

// Arma las condiciones WHERE + sus parámetros a partir del filtro común.
// Se comparte entre paginar/resumen/listarTodo para no repetir la lógica.
function condicionesDe({ fechaDesde, fechaHasta, usuario, accion, modulo, q }) {
  const condiciones = [];
  const parametros = [];

  if (fechaDesde) {
    // El día se cuenta en la zona horaria de la operación, no en UTC.
    condiciones.push('(a.creado_en AT TIME ZONE ?)::date >= ?::date');
    parametros.push(zona(), fechaDesde);
  }
  if (fechaHasta) {
    condiciones.push('(a.creado_en AT TIME ZONE ?)::date <= ?::date');
    parametros.push(zona(), fechaHasta);
  }
  if (usuario) {
    condiciones.push('LOWER(a.usuario) LIKE ?');
    parametros.push(`%${String(usuario).trim().toLowerCase()}%`);
  }
  if (accion) {
    condiciones.push('LOWER(a.accion) = ?');
    parametros.push(String(accion).trim().toLowerCase());
  }
  if (modulo) {
    condiciones.push('LOWER(a.modulo) = ?');
    parametros.push(String(modulo).trim().toLowerCase());
  }
  if (q) {
    const texto = `%${String(q).trim().toLowerCase()}%`;
    condiciones.push(
      '(LOWER(a.usuario) LIKE ? OR LOWER(a.accion) LIKE ? OR LOWER(a.modulo) LIKE ? OR LOWER(a.detalle::text) LIKE ? OR LOWER(a.registro_id::text) LIKE ?)'
    );
    parametros.push(texto, texto, texto, texto, texto);
  }
  return { condiciones, parametros };
}

const COLUMNAS =
  'a.id, a.usuario_id, a.usuario, a.rol, a.accion, a.modulo, a.registro_id, a.detalle, a.creado_en';

class PgAuditRepository extends AuditRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async registrar({ usuarioId, usuario, rol, accion, modulo, registroId = null, detalle = null }) {
    await this.db.query(
      'INSERT INTO auditoria_combustible(usuario_id,usuario,rol,accion,modulo,registro_id,detalle) VALUES(?,?,?,?,?,?,?)',
      [
        usuarioId || null,
        usuario || null,
        rol || null,
        accion,
        modulo,
        registroId || null,
        detalle ? JSON.stringify(detalle) : null
      ]
    );
  }

  async obtener(id) {
    const [rows] = await this.db.query(
      `SELECT ${COLUMNAS} FROM auditoria_combustible a WHERE a.id=? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  async paginar(filtros) {
    const { condiciones, parametros } = condicionesDe(filtros);
    const baseSql = 'FROM auditoria_combustible a WHERE 1=1';
    const whereSql = condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '';
    const limite = filtros.limite;
    const offset = (filtros.pagina - 1) * limite;

    const [totalRows] = await this.db.query(
      `SELECT COUNT(*) AS total ${baseSql}${whereSql}`,
      parametros
    );
    const [registros] = await this.db.query(
      `SELECT ${COLUMNAS} ${baseSql}${whereSql} ORDER BY a.creado_en DESC LIMIT ? OFFSET ?`,
      [...parametros, limite, offset]
    );
    return { registros, total: Number(totalRows[0]?.total || 0) };
  }

  async resumen(filtros) {
    const { condiciones, parametros } = condicionesDe(filtros);
    const baseSql = 'FROM auditoria_combustible a WHERE 1=1';
    const whereSql = condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '';
    const [rows] = await this.db.query(
      `SELECT COUNT(*) AS total_eventos, COUNT(DISTINCT a.usuario) AS usuarios_unicos, COUNT(DISTINCT a.accion) AS acciones_unicas, COUNT(DISTINCT a.modulo) AS modulos_unicos ${baseSql}${whereSql}`,
      parametros
    );
    return (
      rows[0] || { total_eventos: 0, usuarios_unicos: 0, acciones_unicas: 0, modulos_unicos: 0 }
    );
  }

  async listarTodo(filtros) {
    const { condiciones, parametros } = condicionesDe(filtros);
    const baseSql = 'FROM auditoria_combustible a WHERE 1=1';
    const whereSql = condiciones.length ? ` AND ${condiciones.join(' AND ')}` : '';
    const [rows] = await this.db.query(
      `SELECT ${COLUMNAS} ${baseSql}${whereSql} ORDER BY a.creado_en DESC`,
      parametros
    );
    return rows;
  }
}

module.exports = { PgAuditRepository };
