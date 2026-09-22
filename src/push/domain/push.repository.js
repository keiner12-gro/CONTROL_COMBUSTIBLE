// ============================================================================
// push.repository.js (DOMINIO) — CONTRATO DE LAS SUSCRIPCIONES PUSH
// ----------------------------------------------------------------------------
// Lo que push.service.js necesita para guardar/consultar los dispositivos
// suscritos a las notificaciones, sin decir CÓMO se guarda.
// Implementaciones reales:
//   infrastructure/pg-push.repository.js       (Postgres/Supabase)
//   infrastructure/airtable-push.repository.js (Airtable)
// ============================================================================

const pendiente = () => {
  throw new Error('Not implemented');
};

class PushRepository {
  async suscribir() {
    return pendiente(); // Guarda (o actualiza) el dispositivo de un usuario
  }

  async desuscribir() {
    return pendiente(); // Quita un dispositivo
  }

  async dispositivos() {
    return pendiente(); // Dispositivos que cumplen el criterio (roles/vista/usuarioIds)
  }

  async eliminarPorId() {
    return pendiente(); // Olvida un dispositivo (p. ej. si el navegador lo desinstaló)
  }
}

module.exports = { PushRepository };
