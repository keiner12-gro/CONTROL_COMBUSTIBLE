const { UserRepository } = require('../domain/user.repository');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const {
  hashPassword,
  verifyPassword,
  esHashSeguro
} = require('../../shared/infrastructure/security');

class MySQLUserRepository extends UserRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  normalizarUsuario(usuario) {
    return String(usuario || '').trim();
  }

  async findByCredentials(usuario, contrasena) {
    const usuarioNormalizado = this.normalizarUsuario(usuario);
    const [filas] = await this.db.query(
      'SELECT id, usuario, contrasena, rol, debe_cambiar_contrasena FROM usuarios_combustible WHERE LOWER(usuario)=LOWER(?) LIMIT 1',
      [usuarioNormalizado]
    );
    const encontrado = filas[0];
    if (!encontrado) return null;

    let valido = verifyPassword(contrasena, encontrado.contrasena);
    // Compatibilidad/migración: si existía una contraseña antigua en texto plano,
    // se valida una sola vez y se convierte inmediatamente a un hash scrypt.
    if (
      !valido &&
      !esHashSeguro(encontrado.contrasena) &&
      String(encontrado.contrasena) === String(contrasena)
    ) {
      const nuevoHash = hashPassword(contrasena);
      await this.db.query('UPDATE usuarios_combustible SET contrasena=? WHERE id=?', [
        nuevoHash,
        encontrado.id
      ]);
      valido = true;
    }
    if (!valido) return null;

    return {
      id: encontrado.id,
      usuario: encontrado.usuario,
      rol: encontrado.rol,
      debe_cambiar_contrasena: encontrado.debe_cambiar_contrasena
    };
  }

  async findById(id) {
    const [filas] = await this.db.query(
      'SELECT id,usuario,rol,debe_cambiar_contrasena FROM usuarios_combustible WHERE id=? LIMIT 1',
      [id]
    );
    return filas[0] || null;
  }

  async list() {
    const [usuarios] = await this.db.query(
      'SELECT id,usuario,rol,debe_cambiar_contrasena,creado_en FROM usuarios_combustible ORDER BY id DESC'
    );
    const [permisos] = await this.db.query(
      'SELECT usuario_id,vista FROM permisos_usuarios_combustible'
    );
    return usuarios.map((usuario) => ({
      ...usuario,
      permisos:
        usuario.rol === 'super_administrador'
          ? VISTAS_DISPONIBLES
          : permisos
              .filter((permiso) => permiso.usuario_id === usuario.id)
              .map((permiso) => permiso.vista)
    }));
  }

  async create(datos) {
    const usuario = this.normalizarUsuario(datos.usuario).toLowerCase();
    const contrasena = String(datos.contrasena || '');
    if (usuario.length < 3)
      throw Object.assign(new Error('El usuario debe tener al menos 3 caracteres.'), {
        status: 400
      });
    if (contrasena.length < 6)
      throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), {
        status: 400
      });
    const hash = hashPassword(contrasena);
    const debeCambiar = contrasena === '123456' ? 1 : 0;
    const [resultado] = await this.db.query(
      'INSERT INTO usuarios_combustible(usuario,contrasena,rol,debe_cambiar_contrasena) VALUES(?,?,?,?)',
      [usuario, hash, datos.rol, debeCambiar]
    );
    return resultado.insertId;
  }

  async update(id, datos) {
    if (datos.contrasena) {
      const contrasena = String(datos.contrasena);
      if (contrasena.length < 6)
        throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), {
          status: 400
        });
      const hash = hashPassword(contrasena);
      const debeCambiar = contrasena === '123456' ? 1 : 0;
      await this.db.query(
        'UPDATE usuarios_combustible SET contrasena=?,rol=?,debe_cambiar_contrasena=? WHERE id=?',
        [hash, datos.rol, debeCambiar, id]
      );
    } else {
      await this.db.query('UPDATE usuarios_combustible SET rol=? WHERE id=?', [datos.rol, id]);
    }
  }

  async remove(id) {
    await this.db.query('DELETE FROM usuarios_combustible WHERE id=?', [id]);
  }

  async getPermissions(id, rol) {
    if (rol === 'super_administrador') return VISTAS_DISPONIBLES;
    const [permisos] = await this.db.query(
      'SELECT vista FROM permisos_usuarios_combustible WHERE usuario_id=?',
      [id]
    );
    return permisos.map((permiso) => permiso.vista);
  }

  async changePassword(id, contrasenaActual, nuevaContrasena) {
    const [filas] = await this.db.query(
      'SELECT contrasena FROM usuarios_combustible WHERE id=? LIMIT 1',
      [id]
    );
    if (!filas.length) return false;
    let actualValida = verifyPassword(contrasenaActual, filas[0].contrasena);
    if (
      !actualValida &&
      !esHashSeguro(filas[0].contrasena) &&
      String(filas[0].contrasena) === String(contrasenaActual)
    )
      actualValida = true;
    if (!actualValida) return false;
    const hash = hashPassword(nuevaContrasena);
    await this.db.query(
      'UPDATE usuarios_combustible SET contrasena=?,debe_cambiar_contrasena=0 WHERE id=?',
      [hash, id]
    );
    return true;
  }

  async replacePermissions(id, permisos) {
    await this.db.query('DELETE FROM permisos_usuarios_combustible WHERE usuario_id=?', [id]);
    for (const vista of (permisos || []).filter((v) => VISTAS_DISPONIBLES.includes(v))) {
      await this.db.query(
        'INSERT INTO permisos_usuarios_combustible(usuario_id,vista) VALUES(?,?)',
        [id, vista]
      );
    }
  }
}

module.exports = { MySQLUserRepository };
