const { UserRepository } = require('../domain/user.repository');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const { hashPassword, verifyPassword, esHashSeguro } = require('../../shared/infrastructure/security');

class MySQLUserRepository extends UserRepository {
  constructor(db) { super(); this.db = db; }

  normalizarUsuario(usuario) {
    return String(usuario || '').trim();
  }

  async findByCredentials(usuario, contrasena) {
    const usuarioNormalizado = this.normalizarUsuario(usuario);
    const [r] = await this.db.query('SELECT id, usuario, contrasena, rol, debe_cambiar_contrasena FROM usuarios_combustible WHERE LOWER(usuario)=LOWER(?) LIMIT 1', [usuarioNormalizado]);
    const u = r[0];
    if (!u) return null;

    let valido = verifyPassword(contrasena, u.contrasena);
    // Compatibilidad/migración: si existía una contraseña antigua en texto plano,
    // se valida una sola vez y se convierte inmediatamente a un hash scrypt.
    if (!valido && !esHashSeguro(u.contrasena) && String(u.contrasena) === String(contrasena)) {
      const nuevoHash = hashPassword(contrasena);
      await this.db.query('UPDATE usuarios_combustible SET contrasena=? WHERE id=?', [nuevoHash, u.id]);
      valido = true;
    }
    if (!valido) return null;

    return { id: u.id, usuario: u.usuario, rol: u.rol, debe_cambiar_contrasena: u.debe_cambiar_contrasena };
  }

  async list() {
    const [u] = await this.db.query('SELECT id,usuario,rol,debe_cambiar_contrasena,creado_en FROM usuarios_combustible ORDER BY id DESC');
    const [p] = await this.db.query('SELECT usuario_id,vista FROM permisos_usuarios_combustible');
    return u.map(x => ({
      ...x,
      permisos: x.rol === 'super_administrador' ? VISTAS_DISPONIBLES : p.filter(y => y.usuario_id === x.id).map(y => y.vista)
    }));
  }

  async create(d) {
    const usuario = this.normalizarUsuario(d.usuario).toLowerCase();
    const contrasena = String(d.contrasena || '');
    if (usuario.length < 3) throw Object.assign(new Error('El usuario debe tener al menos 3 caracteres.'), { status: 400 });
    if (contrasena.length < 6) throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), { status: 400 });
    const hash = hashPassword(contrasena);
    const debeCambiar = contrasena === '123456' ? 1 : 0;
    const [r] = await this.db.query('INSERT INTO usuarios_combustible(usuario,contrasena,rol,debe_cambiar_contrasena) VALUES(?,?,?,?)', [usuario, hash, d.rol, debeCambiar]);
    return r.insertId;
  }

  async update(id, d) {
    if (d.contrasena) {
      const contrasena = String(d.contrasena);
      if (contrasena.length < 6) throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), { status: 400 });
      const hash = hashPassword(contrasena);
      const debeCambiar = contrasena === '123456' ? 1 : 0;
      await this.db.query('UPDATE usuarios_combustible SET contrasena=?,rol=?,debe_cambiar_contrasena=? WHERE id=?', [hash, d.rol, debeCambiar, id]);
    } else {
      await this.db.query('UPDATE usuarios_combustible SET rol=? WHERE id=?', [d.rol, id]);
    }
  }

  async remove(id) { await this.db.query('DELETE FROM usuarios_combustible WHERE id=?', [id]); }

  async getPermissions(id, rol) {
    if (rol === 'super_administrador') return VISTAS_DISPONIBLES;
    const [p] = await this.db.query('SELECT vista FROM permisos_usuarios_combustible WHERE usuario_id=?', [id]);
    return p.map(x => x.vista);
  }

  async changePassword(id, contrasenaActual, nuevaContrasena) {
    const [r] = await this.db.query('SELECT contrasena FROM usuarios_combustible WHERE id=? LIMIT 1', [id]);
    if (!r.length) return false;
    let actualValida = verifyPassword(contrasenaActual, r[0].contrasena);
    if (!actualValida && !esHashSeguro(r[0].contrasena) && String(r[0].contrasena) === String(contrasenaActual)) actualValida = true;
    if (!actualValida) return false;
    const hash = hashPassword(nuevaContrasena);
    await this.db.query('UPDATE usuarios_combustible SET contrasena=?,debe_cambiar_contrasena=0 WHERE id=?', [hash, id]);
    return true;
  }

  async replacePermissions(id, permisos) {
    await this.db.query('DELETE FROM permisos_usuarios_combustible WHERE usuario_id=?', [id]);
    for (const p of (permisos || []).filter(x => VISTAS_DISPONIBLES.includes(x))) {
      await this.db.query('INSERT INTO permisos_usuarios_combustible(usuario_id,vista) VALUES(?,?)', [id, p]);
    }
  }
}
module.exports = { MySQLUserRepository };
