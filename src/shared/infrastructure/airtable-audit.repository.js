// ============================================================================
// airtable-audit.repository.js (INFRAESTRUCTURA) — BITÁCORA EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-audit.repository.js.
// ⚠ Airtable no calcula COUNT(DISTINCT ...) ni LIMIT/OFFSET como Postgres: se
// traen TODAS las filas que cumplen el filtro (ordenadas) y la página y el
// resumen se calculan en JavaScript. Con el volumen de esta app (una empresa,
// no miles de eventos por minuto) es un costo razonable; si la bitácora
// llegara a crecer muchísimo, convendría paginar también hacia Airtable.
// ============================================================================

const { AuditRepository } = require('../domain/audit.repository');
const { zona } = require('../application/fechas');
const { textoFormula, combinarFormula } = require('./airtable-formula');

const TABLA = 'auditoria_combustible';

// El campo "creado_en" se guarda en UTC; se traduce a la zona horaria de la
// operación antes de comparar el día, igual que hace Postgres con AT TIME ZONE.
const diaLocal = () =>
  `DATETIME_FORMAT(SET_TIMEZONE({creado_en},${textoFormula(zona())}),'YYYY-MM-DD')`;

function formulaDe({ fechaDesde, fechaHasta, usuario, accion, modulo, q }) {
  const condiciones = [];
  if (fechaDesde) condiciones.push(`${diaLocal()}>=${textoFormula(fechaDesde)}`);
  if (fechaHasta) condiciones.push(`${diaLocal()}<=${textoFormula(fechaHasta)}`);
  if (usuario) condiciones.push(`FIND(LOWER(${textoFormula(usuario)}),LOWER({usuario}))>0`);
  if (accion) condiciones.push(`LOWER({accion})=${textoFormula(String(accion).toLowerCase())}`);
  if (modulo) condiciones.push(`LOWER({modulo})=${textoFormula(String(modulo).toLowerCase())}`);
  if (q) {
    const valor = textoFormula(q);
    condiciones.push(
      combinarFormula('OR', [
        `FIND(LOWER(${valor}),LOWER({usuario}))>0`,
        `FIND(LOWER(${valor}),LOWER({accion}))>0`,
        `FIND(LOWER(${valor}),LOWER({modulo}))>0`,
        `FIND(LOWER(${valor}),LOWER({detalle}))>0`,
        `FIND(LOWER(${valor}),LOWER({registro_id}))>0`
      ])
    );
  }
  return combinarFormula('AND', condiciones);
}

class AirtableAuditRepository extends AuditRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  async registrar({ usuarioId, usuario, rol, accion, modulo, registroId = null, detalle = null }) {
    await this.cliente.crear(TABLA, [
      {
        usuario_id: usuarioId || null,
        usuario: usuario || null,
        rol: rol || null,
        accion,
        modulo,
        registro_id: registroId ? String(registroId) : null,
        detalle: detalle ? JSON.stringify(detalle) : null,
        creado_en: new Date().toISOString()
      }
    ]);
  }

  async obtener(id) {
    return this.cliente.obtener(TABLA, id);
  }

  async filtradas(filtros) {
    return this.cliente.listar(TABLA, {
      formula: formulaDe(filtros),
      orden: [{ campo: 'creado_en', direccion: 'desc' }]
    });
  }

  async paginar(filtros) {
    const todas = await this.filtradas(filtros);
    const desde = (filtros.pagina - 1) * filtros.limite;
    return { registros: todas.slice(desde, desde + filtros.limite), total: todas.length };
  }

  async resumen(filtros) {
    const todas = await this.filtradas(filtros);
    const unicos = (campo) => new Set(todas.map((f) => f[campo]).filter(Boolean)).size;
    return {
      total_eventos: todas.length,
      usuarios_unicos: unicos('usuario'),
      acciones_unicas: unicos('accion'),
      modulos_unicos: unicos('modulo')
    };
  }

  async listarTodo(filtros) {
    return this.filtradas(filtros);
  }
}

module.exports = { AirtableAuditRepository };
