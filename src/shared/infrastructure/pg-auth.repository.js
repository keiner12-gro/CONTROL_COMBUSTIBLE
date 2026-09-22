// ============================================================================
// pg-auth.repository.js (INFRAESTRUCTURA) — SESIONES Y LOGIN EN POSTGRES
// ----------------------------------------------------------------------------
// Extracción EXACTA (mismo SQL, mismos parámetros) del código que antes vivía
// dentro de security.js. No cambia ningún comportamiento: solo se movió aquí
// para que security.js pueda funcionar también con Airtable (ver
// airtable-auth.repository.js), sin tocar su lógica de cookies ni de scrypt.
// ============================================================================

const { AuthRepository } = require('../domain/auth.repository');

class PgAuthRepository extends AuthRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async crearSesion({ tokenHash, usuarioId, expiraEn, ip, agente }) {
    await this.db.query('DELETE FROM sesiones_combustible WHERE expira_en < NOW()'); // Limpieza de sesiones vencidas
    await this.db.query(
      'INSERT INTO sesiones_combustible(token_hash,usuario_id,expira_en,ip,agente) VALUES(?,?,?,?,?)',
      [tokenHash, usuarioId, expiraEn, ip, agente]
    );
  }

  // UNA sola consulta trae la sesión vigente, el usuario dueño y sus permisos
  // (cada consulta a Supabase cuesta latencia, y esto corre en TODA petición).
  async buscarSesionConPermisos(tokenHash) {
    const [rows] = await this.db.query(
      `
      SELECT s.usuario_id, u.usuario, u.rol, u.debe_cambiar_contrasena,
             (s.ultimo_uso IS NULL OR s.ultimo_uso < NOW() - INTERVAL '1 minute') AS marcar_uso,
             COALESCE(ARRAY_AGG(p.vista) FILTER (WHERE p.vista IS NOT NULL), '{}') AS permisos
      FROM sesiones_combustible s
      INNER JOIN usuarios_combustible u ON u.id=s.usuario_id
      LEFT JOIN permisos_usuarios_combustible p ON p.usuario_id=u.id
      WHERE s.token_hash=? AND s.expira_en > NOW()
      GROUP BY s.id, u.id
      LIMIT 1
    `,
      [tokenHash]
    );
    if (!rows.length) return null;
    const { marcar_uso: marcarUso, usuario_id: usuarioId, ...resto } = rows[0];
    return { usuarioId, marcarUso, ...resto };
  }

  // Marca de actividad de la sesión. Se llama como mucho una vez por minuto
  // (lo decide buscarSesionConPermisos con "marcarUso"), para no sumar una
  // escritura a cada petición.
  async marcarUltimoUso(tokenHash) {
    await this.db.query('UPDATE sesiones_combustible SET ultimo_uso=NOW() WHERE token_hash=?', [
      tokenHash
    ]);
  }

  async eliminarSesionPorToken(tokenHash) {
    await this.db.query('DELETE FROM sesiones_combustible WHERE token_hash=?', [tokenHash]);
  }

  async limpiarSesionesVencidas() {
    await this.db.query('DELETE FROM sesiones_combustible WHERE expira_en < NOW()');
  }

  async obtenerIntento(clave) {
    const [filas] = await this.db.query(
      'SELECT intentos, EXTRACT(EPOCH FROM (NOW() - primer_intento))::float8 AS segundos FROM intentos_login_combustible WHERE clave=?',
      [clave]
    );
    return filas[0] || null;
  }

  async registrarIntentoFallido(clave, ventanaSegundos) {
    await this.db.query(
      `INSERT INTO intentos_login_combustible(clave,intentos,primer_intento) VALUES(?,1,NOW())
       ON CONFLICT (clave) DO UPDATE SET
         intentos = CASE WHEN EXTRACT(EPOCH FROM (NOW() - intentos_login_combustible.primer_intento)) >= ? THEN 1 ELSE intentos_login_combustible.intentos + 1 END,
         primer_intento = CASE WHEN EXTRACT(EPOCH FROM (NOW() - intentos_login_combustible.primer_intento)) >= ? THEN NOW() ELSE intentos_login_combustible.primer_intento END`,
      [clave, ventanaSegundos, ventanaSegundos]
    );
  }

  async limpiarIntento(clave) {
    await this.db.query('DELETE FROM intentos_login_combustible WHERE clave=?', [clave]);
  }
}

module.exports = { PgAuthRepository };
