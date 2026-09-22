// ============================================================================
// airtable-user.repository.js (INFRAESTRUCTURA) — USUARIOS Y PERMISOS EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-user.repository.js (UserRepository), pero contra
// Airtable. Diferencias importantes frente a Postgres, por si algo se ve raro:
//   * El "id" del usuario es el id de fila de Airtable (texto "recXXXX..."),
//     no un número. La app ya trata los id como texto en casi todas partes.
//   * No existe una restricción "usuario único": se comprueba a mano antes de
//     crear (findByCredentials/create) y se devuelve el mismo error 409 que
//     daría Postgres, para no cambiar el comportamiento que ve el usuario.
//   * Postgres borra en cascada los permisos y sesiones al borrar un usuario
//     (ON DELETE CASCADE) y deja en null el usuario_id de su auditoría
//     (ON DELETE SET NULL). Aquí eso se hace a mano en remove().
// ============================================================================

const { UserRepository } = require('../domain/user.repository');
const { VISTAS_DISPONIBLES } = require('../../shared/application/permisos');
const {
  hashPassword,
  verifyPassword,
  esHashSeguro
} = require('../../shared/infrastructure/security');
const { textoFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'usuarios_combustible';
const TABLA_PERMISOS = 'permisos_usuarios_combustible';
const TABLA_SESIONES = 'sesiones_combustible';
const TABLA_PUSH = 'suscripciones_push';
const TABLA_AUDITORIA = 'auditoria_combustible';

const duplicado = () =>
  Object.assign(new Error('Ya existe un registro con esos datos.'), { status: 409 });

class AirtableUserRepository extends UserRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  normalizarUsuario(usuario) {
    return String(usuario || '').trim();
  }

  async buscarPorUsuario(usuarioNormalizado, tx = this.cliente) {
    const filas = await tx.listar(TABLA, {
      formula: `LOWER({usuario})=${textoFormula(usuarioNormalizado.toLowerCase())}`,
      maxFilas: 1
    });
    return filas[0] || null;
  }

  async findByCredentials(usuario, contrasena) {
    const encontrado = await this.buscarPorUsuario(this.normalizarUsuario(usuario));
    if (!encontrado) return null;

    let valido = verifyPassword(contrasena, encontrado.contrasena);
    // Compatibilidad: contraseña vieja sin cifrar, se valida una vez y se cifra.
    if (
      !valido &&
      !esHashSeguro(encontrado.contrasena) &&
      String(encontrado.contrasena) === String(contrasena)
    ) {
      await this.cliente.actualizar(TABLA, [
        { id: encontrado.id, campos: { contrasena: hashPassword(contrasena) } }
      ]);
      valido = true;
    }
    if (!valido) return null;

    return {
      id: encontrado.id,
      usuario: encontrado.usuario,
      rol: encontrado.rol,
      debe_cambiar_contrasena: Boolean(encontrado.debe_cambiar_contrasena)
    };
  }

  async findById(id) {
    const fila = await this.cliente.obtener(TABLA, id);
    if (!fila) return null;
    return {
      id: fila.id,
      usuario: fila.usuario,
      rol: fila.rol,
      debe_cambiar_contrasena: Boolean(fila.debe_cambiar_contrasena)
    };
  }

  async list() {
    const [usuarios, permisos] = await Promise.all([
      this.cliente.listar(TABLA, { orden: [{ campo: 'creado_en', direccion: 'desc' }] }),
      this.cliente.listar(TABLA_PERMISOS)
    ]);
    return usuarios.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      rol: u.rol,
      debe_cambiar_contrasena: Boolean(u.debe_cambiar_contrasena),
      creado_en: u.creado_en,
      permisos:
        u.rol === 'super_administrador'
          ? VISTAS_DISPONIBLES
          : permisos.filter((p) => p.usuario_id === u.id).map((p) => p.vista)
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
    if (await this.buscarPorUsuario(usuario)) throw duplicado(); // Sin restricción única en Airtable: se comprueba a mano

    const [fila] = await this.cliente.crear(TABLA, [
      {
        usuario,
        contrasena: hashPassword(contrasena),
        rol: datos.rol,
        debe_cambiar_contrasena: contrasena === '123456',
        creado_en: new Date().toISOString()
      }
    ]);
    return fila.id;
  }

  async update(id, datos) {
    if (datos.contrasena) {
      const contrasena = String(datos.contrasena);
      if (contrasena.length < 6)
        throw Object.assign(new Error('La contraseña debe tener al menos 6 caracteres.'), {
          status: 400
        });
      await this.cliente.actualizar(TABLA, [
        {
          id,
          campos: {
            contrasena: hashPassword(contrasena),
            rol: datos.rol,
            debe_cambiar_contrasena: contrasena === '123456'
          }
        }
      ]);
    } else {
      await this.cliente.actualizar(TABLA, [{ id, campos: { rol: datos.rol } }]);
    }
  }

  // Borra el usuario y limpia lo que dependía de él: sus permisos y sesiones
  // desaparecen (como el ON DELETE CASCADE de Postgres); su auditoría se
  // conserva pero queda sin el enlace al usuario (como el ON DELETE SET NULL).
  async remove(id) {
    const [permisos, sesiones, push, auditoria] = await Promise.all([
      this.cliente.listar(TABLA_PERMISOS, { formula: `{usuario_id}=${textoFormula(id)}` }),
      this.cliente.listar(TABLA_SESIONES, { formula: `{usuario_id}=${textoFormula(id)}` }),
      this.cliente.listar(TABLA_PUSH, { formula: `{usuario_id}=${textoFormula(id)}` }),
      this.cliente.listar(TABLA_AUDITORIA, { formula: `{usuario_id}=${textoFormula(id)}` })
    ]);
    if (permisos.length)
      await this.cliente.eliminar(
        TABLA_PERMISOS,
        permisos.map((p) => p.id)
      );
    if (sesiones.length)
      await this.cliente.eliminar(
        TABLA_SESIONES,
        sesiones.map((s) => s.id)
      );
    if (push.length)
      await this.cliente.eliminar(
        TABLA_PUSH,
        push.map((s) => s.id)
      );
    if (auditoria.length)
      await this.cliente.actualizar(
        TABLA_AUDITORIA,
        auditoria.map((a) => ({ id: a.id, campos: { usuario_id: null } }))
      );
    await this.cliente.eliminar(TABLA, [id]);
  }

  async getPermissions(id, rol) {
    if (rol === 'super_administrador') return VISTAS_DISPONIBLES;
    const filas = await this.cliente.listar(TABLA_PERMISOS, {
      formula: `{usuario_id}=${textoFormula(id)}`
    });
    return filas.map((p) => p.vista);
  }

  async changePassword(id, contrasenaActual, nuevaContrasena) {
    const fila = await this.cliente.obtener(TABLA, id);
    if (!fila) return false;
    let actualValida = verifyPassword(contrasenaActual, fila.contrasena);
    if (
      !actualValida &&
      !esHashSeguro(fila.contrasena) &&
      String(fila.contrasena) === String(contrasenaActual)
    )
      actualValida = true;
    if (!actualValida) return false;
    await this.cliente.actualizar(TABLA, [
      { id, campos: { contrasena: hashPassword(nuevaContrasena), debe_cambiar_contrasena: false } }
    ]);
    return true;
  }

  async replacePermissions(id, permisos) {
    const actuales = await this.cliente.listar(TABLA_PERMISOS, {
      formula: `{usuario_id}=${textoFormula(id)}`
    });
    if (actuales.length)
      await this.cliente.eliminar(
        TABLA_PERMISOS,
        actuales.map((p) => p.id)
      );
    const vistasUnicas = [
      ...new Set((permisos || []).filter((v) => VISTAS_DISPONIBLES.includes(v)))
    ];
    if (vistasUnicas.length)
      await this.cliente.crear(
        TABLA_PERMISOS,
        vistasUnicas.map((vista) => ({
          usuario_id: id,
          vista,
          creado_en: new Date().toISOString()
        }))
      );
  }
}

module.exports = { AirtableUserRepository };
