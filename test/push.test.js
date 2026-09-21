// Pruebas del contacto VAPID de las notificaciones push.
process.env.VAPID_PUBLIC_KEY = 'publica';
process.env.VAPID_PRIVATE_KEY = 'privada';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PushService } = require('../src/push/push.service');

function contactoUsado(valor) {
  process.env.VAPID_SUBJECT = valor;
  let usado;
  new PushService(null, { setVapidDetails: (c) => (usado = c) }).asegurarConfiguracion();
  return usado;
}

test('un correo suelto recibe el prefijo mailto:', () => {
  assert.equal(contactoUsado('alguien@empresa.com'), 'mailto:alguien@empresa.com');
});

test('mailto: y https:// se respetan tal cual', () => {
  assert.equal(contactoUsado('mailto:alguien@empresa.com'), 'mailto:alguien@empresa.com');
  assert.equal(contactoUsado('https://empresa.com/contacto'), 'https://empresa.com/contacto');
});
