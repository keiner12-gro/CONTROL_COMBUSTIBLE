// ============================================================================
// pg-push.repository.js (INFRAESTRUCTURA) — SUSCRIPCIONES PUSH EN POSTGRES
// ----------------------------------------------------------------------------
// Extracción exacta del SQL que antes vivía dentro de push.service.js.
// ============================================================================

const { PushRepository } = require('../domain/push.repository');

class PgPushRepository extends PushRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async suscribir(usuarioId, { endpoint, p256dh, auth }, agente) {
    await this.db.query(
      `INSERT INTO suscripciones_push(usuario_id,endpoint,p256dh,auth,agente) VALUES(?,?,?,?,?)
       ON CONFLICT (endpoint) DO UPDATE SET usuario_id=EXCLUDED.usuario_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,agente=EXCLUDED.agente`,
      [usuarioId, endpoint, p256dh, auth, agente]
    );
  }

  async desuscribir(usuarioId, endpoint) {
    await this.db.query('DELETE FROM suscripciones_push WHERE endpoint=? AND usuario_id=?', [
      endpoint,
      usuarioId
    ]);
  }

  async dispositivos({ roles = [], vista = null, usuarioIds = [], requiereVista = null } = {}) {
    const condiciones = [];
    const parametros = [];
    if (roles.length) {
      condiciones.push(`u.rol IN (${roles.map(() => '?').join(',')})`);
      parametros.push(...roles);
    }
    if (vista) {
      condiciones.push(
        'EXISTS (SELECT 1 FROM permisos_usuarios_combustible p WHERE p.usuario_id=u.id AND p.vista=?)'
      );
      parametros.push(vista);
    }
    if (usuarioIds.length) {
      condiciones.push(`u.id IN (${usuarioIds.map(() => '?').join(',')})`);
      parametros.push(...usuarioIds);
    }
    if (!condiciones.length) return [];
    // requiereVista: además de cumplir lo anterior, el usuario debe poder ENTRAR a esa
    // pantalla (el super administrador siempre puede). Así nadie recibe un aviso que
    // luego no puede abrir.
    let filtroPermiso = '';
    if (requiereVista) {
      filtroPermiso =
        " AND (u.rol='super_administrador' OR EXISTS (SELECT 1 FROM permisos_usuarios_combustible pv WHERE pv.usuario_id=u.id AND pv.vista=?))";
      parametros.push(requiereVista);
    }
    const [filas] = await this.db.query(
      `SELECT s.id,s.endpoint,s.p256dh,s.auth FROM suscripciones_push s INNER JOIN usuarios_combustible u ON u.id=s.usuario_id WHERE (${condiciones.join(' OR ')})${filtroPermiso}`,
      parametros
    );
    return filas;
  }

  async eliminarPorId(id) {
    await this.db.query('DELETE FROM suscripciones_push WHERE id=?', [id]);
  }
}

module.exports = { PgPushRepository };
