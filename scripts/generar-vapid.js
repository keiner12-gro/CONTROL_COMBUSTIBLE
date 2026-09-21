// ============================================================================
// generar-vapid.js — CLAVES PARA NOTIFICACIONES PUSH (npm run generar-vapid)
// ----------------------------------------------------------------------------
// Genera el par de claves VAPID (gratis). Copia las 3 líneas a tu .env local y
// a las variables de entorno de Vercel. La clave PRIVADA no se comparte.
// Si cambias las claves, los dispositivos deben volver a activar el aviso.
// ============================================================================

const webpush = require('web-push');
const claves = webpush.generateVAPIDKeys();
console.log('\nPega estas líneas en tu .env y en Vercel (Settings > Environment Variables):\n');
console.log(`VAPID_PUBLIC_KEY=${claves.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${claves.privateKey}`);
console.log('VAPID_SUBJECT=mailto:tu-correo@ejemplo.com\n');
