// ============================================================================
// airtable-push.repository.js (INFRAESTRUCTURA) — SUSCRIPCIONES PUSH EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-push.repository.js. Sin JOIN disponible: se traen los
// usuarios y sus permisos (tablas pequeñas) y el cruce se hace en JavaScript.
// ============================================================================

const { PushRepository } = require('../domain/push.repository');
const { textoFormula, combinarFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'suscripciones_push';
const TABLA_USUARIOS = 'usuarios_combustible';
const TABLA_PERMISOS = 'permisos_usuarios_combustible';

class AirtablePushRepository extends PushRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  async suscribir(usuarioId, { endpoint, p256dh, auth }, agente) {
    const existentes = await this.cliente.listar(TABLA, {
      formula: `{endpoint}=${textoFormula(endpoint)}`,
      maxFilas: 1
    });
    const campos = { usuario_id: usuarioId, endpoint, p256dh, auth, agente };
    if (existentes[0]) await this.cliente.actualizar(TABLA, [{ id: existentes[0].id, campos }]);
    else await this.cliente.crear(TABLA, [{ ...campos, creado_en: new Date().toISOString() }]);
  }

  async desuscribir(usuarioId, endpoint) {
    const filas = await this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{endpoint}=${textoFormula(endpoint)}`,
        `{usuario_id}=${textoFormula(usuarioId)}`
      ])
    });
    if (filas.length)
      await this.cliente.eliminar(
        TABLA,
        filas.map((f) => f.id)
      );
  }

  async dispositivos({ roles = [], vista = null, usuarioIds = [], requiereVista = null } = {}) {
    if (!roles.length && !vista && !usuarioIds.length) return [];

    const [usuarios, permisos] = await Promise.all([
      this.cliente.listar(TABLA_USUARIOS),
      this.cliente.listar(TABLA_PERMISOS)
    ]);
    const permisosDe = (usuarioId) =>
      permisos.filter((p) => p.usuario_id === usuarioId).map((p) => p.vista);

    const cumpleCriterio = (u) =>
      (roles.length && roles.includes(u.rol)) ||
      (vista && permisosDe(u.id).includes(vista)) ||
      (usuarioIds.length && usuarioIds.includes(u.id));
    const puedeVerVista = (u) =>
      u.rol === 'super_administrador' || permisosDe(u.id).includes(requiereVista);

    const idsDestino = usuarios
      .filter((u) => cumpleCriterio(u) && (!requiereVista || puedeVerVista(u)))
      .map((u) => u.id);
    if (!idsDestino.length) return [];

    return this.cliente.listar(TABLA, {
      formula: combinarFormula(
        'OR',
        idsDestino.map((id) => `{usuario_id}=${textoFormula(id)}`)
      )
    });
  }

  async eliminarPorId(id) {
    await this.cliente.eliminar(TABLA, [id]);
  }
}

module.exports = { AirtablePushRepository };
