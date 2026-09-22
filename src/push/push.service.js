// ============================================================================
// push.service.js (APLICACIÓN) — NOTIFICACIONES PUSH (Web Push)
// ----------------------------------------------------------------------------
// Envía avisos al celular/tablet aunque la app esté cerrada. Funciona con la
// app instalada (PWA o APK) en Android, y en iPhone con la app añadida a la
// pantalla de inicio (iOS 16.4 o superior).
// "pushRepository" guarda de verdad los dispositivos suscritos (Postgres o
// Airtable, según DB_PROVIDER); ver src/push/domain/push.repository.js.
// Configuración (.env / Vercel): claves VAPID, se generan gratis con
//   npm run generar-vapid
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tu@correo)
// Sin claves, todo sigue funcionando y simplemente no se envían push.
// ============================================================================

class PushService {
  // "webpush" se inyecta para poder probar sin enviar nada de verdad.
  constructor(pushRepository, webpush = require('web-push')) {
    this.pushRepository = pushRepository;
    this.webpush = webpush;
    this.configurado = false;
  }

  clavePublica() {
    return process.env.VAPID_PUBLIC_KEY || null;
  }

  activo() {
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  // Prepara la librería la primera vez que se necesita.
  asegurarConfiguracion() {
    if (this.configurado || !this.activo()) return;
    // El contacto debe ser "mailto:correo" o una URL https. Si escribieron solo el
    // correo, se le agrega "mailto:" (el servicio de push rechaza el correo suelto).
    let contacto = String(process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
    if (/^[^@\s:]+@[^@\s]+$/.test(contacto)) contacto = `mailto:${contacto}`;
    this.webpush.setVapidDetails(
      contacto,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    this.configurado = true;
  }

  // Guarda (o actualiza) el dispositivo de un usuario.
  async suscribir(usuarioId, suscripcion, agente) {
    const endpoint = String(suscripcion?.endpoint || '');
    const p256dh = String(suscripcion?.keys?.p256dh || '');
    const auth = String(suscripcion?.keys?.auth || '');
    if (!endpoint.startsWith('https://') || !p256dh || !auth)
      throw Object.assign(new Error('La suscripción no es válida.'), { status: 400 });
    await this.pushRepository.suscribir(
      usuarioId,
      { endpoint, p256dh, auth },
      String(agente || '').slice(0, 255)
    );
  }

  async desuscribir(usuarioId, endpoint) {
    await this.pushRepository.desuscribir(usuarioId, String(endpoint || ''));
  }

  // Dispositivos que deben recibir un aviso:
  //   roles: cualquiera de esos roles;  vista: quien tenga ese permiso;
  //   usuarioIds: usuarios concretos;  requiereVista: filtro extra por permiso de pantalla.
  dispositivos(criterio) {
    return this.pushRepository.dispositivos(criterio);
  }

  // Envía la notificación a todos los dispositivos que cumplan el criterio.
  // payload: { titulo, cuerpo, url, etiqueta }. Nunca lanza error: un fallo de
  // push no debe romper el trabajo que lo originó.
  async notificar(criterio, payload) {
    if (!this.activo()) return { enviados: 0, omitido: true };
    try {
      this.asegurarConfiguracion();
      const destinos = await this.dispositivos(criterio);
      const mensaje = JSON.stringify(payload);
      let enviados = 0;
      for (const destino of destinos) {
        try {
          await this.webpush.sendNotification(
            { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
            mensaje,
            { TTL: 12 * 60 * 60 } // Si el equipo está apagado, el aviso vive 12 horas
          );
          enviados += 1;
        } catch (error) {
          // 404/410 = el dispositivo ya no existe (desinstalaron la app): se olvida.
          if (error.statusCode === 404 || error.statusCode === 410)
            await this.pushRepository.eliminarPorId(destino.id);
          else console.warn('No se pudo enviar el push:', error.statusCode || error.message);
        }
      }
      return { enviados, dispositivos: destinos.length };
    } catch (error) {
      console.warn('Error enviando notificaciones push:', error.message);
      return { enviados: 0, error: error.message };
    }
  }
}

module.exports = { PushService };
