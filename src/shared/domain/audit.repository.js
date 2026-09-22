// ============================================================================
// audit.repository.js (DOMINIO) — CONTRATO DE LA BITÁCORA
// ----------------------------------------------------------------------------
// Lo que audit.js y auditoria.routes.js necesitan para escribir y consultar la
// bitácora, sin decir CÓMO se guarda (Postgres o Airtable).
// Todos los métodos de consulta reciben el mismo objeto de filtros:
//   { fechaDesde, fechaHasta, usuario, accion, modulo, q }
// (todos opcionales; "q" es la búsqueda libre). "paginar" además recibe
// "pagina" y "limite".
// Implementaciones reales:
//   infrastructure/pg-audit.repository.js       (Postgres/Supabase)
//   infrastructure/airtable-audit.repository.js (Airtable)
// ============================================================================

const pendiente = () => {
  throw new Error('Not implemented');
};

class AuditRepository {
  async registrar() {
    return pendiente(); // Agrega un evento nuevo (nunca se edita ni se borra)
  }

  async obtener() {
    return pendiente(); // Un evento por id, o null
  }

  async paginar() {
    return pendiente(); // { registros, total } de una página de resultados filtrados
  }

  async resumen() {
    return pendiente(); // { total_eventos, usuarios_unicos, acciones_unicas, modulos_unicos }
  }

  async listarTodo() {
    return pendiente(); // Todos los eventos que cumplen el filtro, sin paginar (para exportar)
  }
}

module.exports = { AuditRepository };
