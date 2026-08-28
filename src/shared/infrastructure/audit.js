async function registrarAuditoria(db, { usuarioId, usuario, rol, accion, modulo, registroId = null, detalle = null }) {
  try {
    await db.query(
      'INSERT INTO auditoria_combustible(usuario_id,usuario,rol,accion,modulo,registro_id,detalle) VALUES(?,?,?,?,?,?,?)',
      [usuarioId || null, usuario || null, rol || null, accion, modulo, registroId || null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (error) {
    console.warn('No se pudo registrar la auditoría:', error.message);
  }
}

module.exports = { registrarAuditoria };
