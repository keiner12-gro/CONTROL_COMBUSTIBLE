// ============================================================================
// audit.js — BITÁCORA DE AUDITORÍA
// ----------------------------------------------------------------------------
// Función única que guarda una línea en la tabla auditoria_combustible cada vez
// que alguien crea, edita, anula o consulta algo importante. Los routers la
// llaman después de completar la operación.
// La vista que muestra estos datos es /auditoria (auditoria.routes.js).
// ============================================================================

async function registrarAuditoria(
  db,
  // usuarioId/usuario/rol: quién lo hizo (salen de req.user).
  // accion: CREAR, EDITAR, ANULAR, LOGIN... | modulo: registros, tractores...
  // registroId: id del elemento afectado | detalle: objeto libre con el contexto.
  { usuarioId, usuario, rol, accion, modulo, registroId = null, detalle = null }
) {
  try {
    await db.query(
      'INSERT INTO auditoria_combustible(usuario_id,usuario,rol,accion,modulo,registro_id,detalle) VALUES(?,?,?,?,?,?,?)',
      [
        usuarioId || null,
        usuario || null,
        rol || null,
        accion,
        modulo,
        registroId || null,
        detalle ? JSON.stringify(detalle) : null // La columna "detalle" es de tipo JSON
      ]
    );
  } catch (error) {
    // La auditoría nunca debe tumbar la operación principal: si falla, solo se
    // advierte en los logs y la petición del usuario continúa con éxito.
    console.warn('No se pudo registrar la auditoría:', error.message);
  }
}

module.exports = { registrarAuditoria };
