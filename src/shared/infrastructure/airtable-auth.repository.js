// ============================================================================
// airtable-auth.repository.js (INFRAESTRUCTURA) — SESIONES Y LOGIN EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-auth.repository.js. Aquí SÍ vale la pena una pequeña
// caché en memoria: autenticarSolicitud() se ejecuta en TODA petición a /api,
// y sin caché serían hasta 3 llamadas a Airtable por petición (sesión, usuario,
// permisos), chocando fácil con el límite de 5 peticiones/segundo de Airtable.
// Con la caché, lo normal es 1 sola llamada (la de la sesión); el usuario y sus
// permisos se recuerdan CACHE_MS y se refrescan solos al vencer.
// Nota: esto es una caché POR INSTANCIA DEL SERVIDOR (en Vercel, cada función
// serverless tiene la suya). No hace falta que sea compartida: como mucho un
// cambio de permisos tarda CACHE_MS en notarse en una instancia concreta.
// PARA CAMBIAR CUÁNTO DURA LA CACHÉ -> CACHE_MS.
// ============================================================================

const { AuthRepository } = require('../domain/auth.repository');
const { textoFormula, combinarFormula } = require('./airtable-formula');

const TABLA_SESIONES = 'sesiones_combustible';
const TABLA_USUARIOS = 'usuarios_combustible';
const TABLA_PERMISOS = 'permisos_usuarios_combustible';
const TABLA_INTENTOS = 'intentos_login_combustible';
const CACHE_MS = 60 * 1000; // 1 minuto

class AirtableAuthRepository extends AuthRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
    this.cacheUsuarios = new Map(); // usuarioId -> { valor, hasta }
  }

  async usuarioConPermisos(usuarioId) {
    const enCache = this.cacheUsuarios.get(usuarioId);
    if (enCache && enCache.hasta > Date.now()) return enCache.valor;

    const [usuario, permisos] = await Promise.all([
      this.cliente.obtener(TABLA_USUARIOS, usuarioId),
      this.cliente.listar(TABLA_PERMISOS, { formula: `{usuario_id}=${textoFormula(usuarioId)}` })
    ]);
    if (!usuario) return null;
    const valor = {
      usuario: usuario.usuario,
      rol: usuario.rol,
      debe_cambiar_contrasena: Boolean(usuario.debe_cambiar_contrasena),
      permisos: permisos.map((p) => p.vista)
    };
    this.cacheUsuarios.set(usuarioId, { valor, hasta: Date.now() + CACHE_MS });
    return valor;
  }

  async crearSesion({ tokenHash, usuarioId, expiraEn, ip, agente }) {
    await this.limpiarSesionesVencidas();
    await this.cliente.crear(TABLA_SESIONES, [
      {
        token_hash: tokenHash,
        usuario_id: usuarioId,
        expira_en: expiraEn,
        ip,
        agente,
        creado_en: new Date().toISOString()
      }
    ]);
  }

  async buscarSesionConPermisos(tokenHash) {
    const filas = await this.cliente.listar(TABLA_SESIONES, {
      formula: combinarFormula('AND', [
        `{token_hash}=${textoFormula(tokenHash)}`,
        `IS_AFTER({expira_en},NOW())`
      ]),
      maxFilas: 1
    });
    const sesion = filas[0];
    if (!sesion) return null;

    const usuario = await this.usuarioConPermisos(sesion.usuario_id);
    if (!usuario) return null; // El usuario dueño de la sesión ya no existe

    const marcarUso =
      !sesion.ultimo_uso || Date.now() - new Date(sesion.ultimo_uso).getTime() > 60 * 1000;
    return { usuarioId: sesion.usuario_id, marcarUso, ...usuario, _tokenHash: tokenHash };
  }

  async marcarUltimoUso(tokenHash) {
    const filas = await this.cliente.listar(TABLA_SESIONES, {
      formula: `{token_hash}=${textoFormula(tokenHash)}`,
      maxFilas: 1
    });
    if (filas[0])
      await this.cliente.actualizar(TABLA_SESIONES, [
        { id: filas[0].id, campos: { ultimo_uso: new Date().toISOString() } }
      ]);
  }

  async eliminarSesionPorToken(tokenHash) {
    const filas = await this.cliente.listar(TABLA_SESIONES, {
      formula: `{token_hash}=${textoFormula(tokenHash)}`
    });
    if (filas.length)
      await this.cliente.eliminar(
        TABLA_SESIONES,
        filas.map((f) => f.id)
      );
  }

  async limpiarSesionesVencidas() {
    const vencidas = await this.cliente.listar(TABLA_SESIONES, {
      formula: `IS_BEFORE({expira_en},NOW())`
    });
    if (vencidas.length)
      await this.cliente.eliminar(
        TABLA_SESIONES,
        vencidas.map((f) => f.id)
      );
  }

  async obtenerIntento(clave) {
    const filas = await this.cliente.listar(TABLA_INTENTOS, {
      formula: `{clave}=${textoFormula(clave)}`,
      maxFilas: 1
    });
    const fila = filas[0];
    if (!fila) return null;
    return {
      intentos: Number(fila.intentos) || 0,
      segundos: (Date.now() - new Date(fila.primer_intento).getTime()) / 1000
    };
  }

  async registrarIntentoFallido(clave, ventanaSegundos) {
    const filas = await this.cliente.listar(TABLA_INTENTOS, {
      formula: `{clave}=${textoFormula(clave)}`,
      maxFilas: 1
    });
    const ahora = new Date().toISOString();
    if (!filas[0]) {
      await this.cliente.crear(TABLA_INTENTOS, [{ clave, intentos: 1, primer_intento: ahora }]);
      return;
    }
    const ventanaVencida =
      (Date.now() - new Date(filas[0].primer_intento).getTime()) / 1000 >= ventanaSegundos;
    await this.cliente.actualizar(TABLA_INTENTOS, [
      {
        id: filas[0].id,
        campos: ventanaVencida
          ? { intentos: 1, primer_intento: ahora }
          : { intentos: (Number(filas[0].intentos) || 0) + 1 }
      }
    ]);
  }

  async limpiarIntento(clave) {
    const filas = await this.cliente.listar(TABLA_INTENTOS, {
      formula: `{clave}=${textoFormula(clave)}`
    });
    if (filas.length)
      await this.cliente.eliminar(
        TABLA_INTENTOS,
        filas.map((f) => f.id)
      );
  }
}

module.exports = { AirtableAuthRepository };
