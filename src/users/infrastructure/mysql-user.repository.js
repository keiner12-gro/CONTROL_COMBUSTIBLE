// ============================================================================
// mysql-user.repository.js (INFRAESTRUCTURA) — SQL DE USUARIOS
// ----------------------------------------------------------------------------
// Implementación real del contrato UserRepository contra MySQL. Todas las
// consultas SQL relacionadas con usuarios y permisos están aquí.
// Nota: todas las consultas usan parámetros "?" (nunca concatenación de texto),
// lo que evita inyección SQL.
// ============================================================================

const { UserRepository } = require('../domain/user.repository'); // Contrato que implementa
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos'); // Lista blanca de vistas
const {
  hashPassword, // Cifra contraseñas nuevas
  verifyPassword, // Compara contraseña escrita vs. hash guardado
  esHashSeguro // Detecta contraseñas antiguas sin cifrar
} = require('../../shared/infrastructure/security');

class MySQLUserRepository extends UserRepository {
  constructor(db) {
    super();
    this.db = db; // Pool de conexiones creado en server.js
  }

  // Quita espacios sobrantes del nombre de usuario.
  normalizarUsuario(usuario) {
    return String(usuario || '').trim();
  }

  // LOGIN: busca el usuario (sin distinguir mayúsculas) y valida la contraseña.
  async findByCredentials(usuario, contrasena) {
    const usuarioNormalizado = this.normalizarUsuario(usuario);
    const [filas] = await this.db.query(
      'SELECT id, usuario, contrasena, rol, debe_cambiar_contrasena FROM usuarios_combustible WHERE LOWER(usuario)=LOWER(?) LIMIT 1',
      [usuarioNormalizado]
    );
    const encontrado = filas[0];
    if (!encontrado) return null; // No existe el usuario

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
    if (!valido) return null; // Contraseña incorrecta

    // Nunca se devuelve el campo "contrasena" hacia afuera.
    return {
      id: encontrado.id,
      usuario: encontrado.usuario,
      rol: encontrado.rol,
      debe_cambiar_contrasena: encontrado.debe_cambiar_contrasena
    };
  }

  // Consulta básica de un usuario por id (sin contraseña).
  async findById(id) {
    const [filas] = await this.db.query(
      'SELECT id,usuario,rol,debe_cambiar_contrasena FROM usuarios_combustible WHERE id=? LIMIT 1',
      [id]
    );
    return filas[0] || null;
  }

  // Listado de usuarios con sus permisos ya incorporados.
  async list() {
    const [usuarios] = await this.db.query(
      'SELECT id,usuario,rol,debe_cambiar_contrasena,creado_en FROM usuarios_combustible ORDER BY id DESC'
    );
    // Se traen TODOS los permisos de una sola consulta y luego se reparten en
    // memoria: así se evita hacer una consulta por cada usuario.
    const [permisos] = await this.db.query(
      'SELECT usuario_id,vista FROM permisos_usuarios_combustible'
    );
    return usuarios.map((usuario) => ({
      ...usuario,
      permisos:
        usuario.rol === 'super_administrador'
          ? VISTAS_DISPONIBLES // El super admin siempre tiene todas las vistas
          : permisos
              .filter((permiso) => permiso.usuario_id === usuario.id)
              .map((permiso) => permiso.vista)
    }));
  }

  // Alta de usuario con validaciones de formato y cifrado de la contraseña.
  async create(datos) {
    const usuario = this.normalizarUsuario(datos.usuario).toLowerCase(); // Se guarda en minúsculas
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
    // Si se crea con la clave temporal 123456, se obliga a cambiarla al entrar.
    const debeCambiar = contrasena === '123456' ? 1 : 0;
    const [resultado] = await this.db.query(
      'INSERT INTO usuarios_combustible(usuario,contrasena,rol,debe_cambiar_contrasena) VALUES(?,?,?,?)',
      [usuario, hash, datos.rol, debeCambiar]
    );
    return resultado.insertId; // Id generado, necesario para guardar los permisos
  }

  // Edición: si viene contraseña se actualiza también; si no, solo el rol.
  async update(id, datos) {
    if (datos.contrasena) {
      const contrasena = String(datos.contrasena);
      if (contrasena.length < 6)
        throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), {
          status: 400
        });
      const hash = hashPassword(contrasena);
      const debeCambiar = contrasena === '123456' ? 1 : 0; // Reset de clave temporal
      await this.db.query(
        'UPDATE usuarios_combustible SET contrasena=?,rol=?,debe_cambiar_contrasena=? WHERE id=?',
        [hash, datos.rol, debeCambiar, id]
      );
    } else {
      await this.db.query('UPDATE usuarios_combustible SET rol=? WHERE id=?', [datos.rol, id]);
    }
  }

  // Baja definitiva del usuario (permisos y sesiones caen en cascada).
  async remove(id) {
    await this.db.query('DELETE FROM usuarios_combustible WHERE id=?', [id]);
  }

  // Vistas permitidas de un usuario; el super admin las tiene todas.
  async getPermissions(id, rol) {
    if (rol === 'super_administrador') return VISTAS_DISPONIBLES;
    const [permisos] = await this.db.query(
      'SELECT vista FROM permisos_usuarios_combustible WHERE usuario_id=?',
      [id]
    );
    return permisos.map((permiso) => permiso.vista);
  }

  // Cambio de contraseña propio: exige acertar la contraseña actual.
  async changePassword(id, contrasenaActual, nuevaContrasena) {
    const [filas] = await this.db.query(
      'SELECT contrasena FROM usuarios_combustible WHERE id=? LIMIT 1',
      [id]
    );
    if (!filas.length) return false; // Usuario inexistente
    let actualValida = verifyPassword(contrasenaActual, filas[0].contrasena);
    // Mismo caso de compatibilidad: contraseña vieja sin cifrar.
    if (
      !actualValida &&
      !esHashSeguro(filas[0].contrasena) &&
      String(filas[0].contrasena) === String(contrasenaActual)
    )
      actualValida = true;
    if (!actualValida) return false; // La contraseña actual no coincide
    const hash = hashPassword(nuevaContrasena);
    // Al cambiarla se apaga la bandera de "debe cambiar contraseña".
    await this.db.query(
      'UPDATE usuarios_combustible SET contrasena=?,debe_cambiar_contrasena=0 WHERE id=?',
      [hash, id]
    );
    return true;
  }

  // Reemplaza los permisos: borra los actuales e inserta los nuevos.
  // Solo se aceptan vistas del catálogo VISTAS_DISPONIBLES (lista blanca) y
  // el Set elimina duplicados.
  async replacePermissions(id, permisos) {
    await this.db.query('DELETE FROM permisos_usuarios_combustible WHERE usuario_id=?', [id]);
    const vistasUnicas = [
      ...new Set((permisos || []).filter((v) => VISTAS_DISPONIBLES.includes(v)))
    ];
    for (const vista of vistasUnicas) {
      await this.db.query(
        'INSERT INTO permisos_usuarios_combustible(usuario_id,vista) VALUES(?,?)',
        [id, vista]
      );
    }
  }
}

module.exports = { MySQLUserRepository };
