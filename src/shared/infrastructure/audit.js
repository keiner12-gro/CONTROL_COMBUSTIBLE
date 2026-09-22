// ============================================================================
// audit.js — BITÁCORA DE AUDITORÍA
// ----------------------------------------------------------------------------
// Función única que guarda una línea en la bitácora cada vez que alguien crea,
// edita, anula o consulta algo importante. Los routers la llaman después de
// completar la operación. "auditRepository" es quien de verdad la guarda
// (Postgres o Airtable, según DB_PROVIDER); ver src/shared/domain/audit.repository.js.
// La vista que muestra estos datos es /auditoria (auditoria.routes.js).
// ============================================================================

async function registrarAuditoria(
  auditRepository,
  // usuarioId/usuario/rol: quién lo hizo (salen de req.user).
  // accion: CREAR, EDITAR, ANULAR, LOGIN... | modulo: registros, tractores...
  // registroId: id del elemento afectado | detalle: objeto libre con el contexto.
  datos
) {
  try {
    await auditRepository.registrar(datos);
  } catch (error) {
    // La auditoría nunca debe tumbar la operación principal: si falla, solo se
    // advierte en los logs y la petición del usuario continúa con éxito.
    console.warn('No se pudo registrar la auditoría:', error.message);
  }
}

module.exports = { registrarAuditoria };
