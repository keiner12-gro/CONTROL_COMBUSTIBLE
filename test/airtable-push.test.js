// ============================================================================
// airtable-push.test.js — PRUEBAS DEL REPOSITORIO DE SUSCRIPCIONES PUSH
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { AirtablePushRepository } = require('../src/push/infrastructure/airtable-push.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtablePushRepository(cliente) };
}

test('suscribir crea, y una segunda vez con el mismo endpoint actualiza (no duplica)', async () => {
  const { repo, servidor } = montar();
  await repo.suscribir('u1', { endpoint: 'https://e1', p256dh: 'p', auth: 'a' }, 'chrome');
  await repo.suscribir('u2', { endpoint: 'https://e1', p256dh: 'p2', auth: 'a2' }, 'firefox');
  const filas = servidor.leerTabla('suscripciones_push');
  assert.equal(filas.length, 1);
  assert.equal(filas[0].usuario_id, 'u2');
});

test('desuscribir borra solo si coincide usuario y endpoint', async () => {
  const { repo, servidor } = montar();
  await repo.suscribir('u1', { endpoint: 'https://e1', p256dh: 'p', auth: 'a' }, '');
  await repo.desuscribir('u2', 'https://e1'); // Usuario distinto: no borra
  assert.equal(servidor.leerTabla('suscripciones_push').length, 1);
  await repo.desuscribir('u1', 'https://e1');
  assert.equal(servidor.leerTabla('suscripciones_push').length, 0);
});

test('dispositivos: por rol, por permiso de vista, por usuario concreto, y requiereVista', async () => {
  const { repo, servidor } = montar();
  const [admin, supervisorConAlertas, supervisorSinAlertas, operario] = servidor.sembrar(
    'usuarios_combustible',
    [
      { usuario: 'admin', rol: 'super_administrador' },
      { usuario: 'sup1', rol: 'supervisor' },
      { usuario: 'sup2', rol: 'supervisor' },
      { usuario: 'op1', rol: 'operario' }
    ]
  );
  servidor.sembrar('permisos_usuarios_combustible', [
    { usuario_id: supervisorConAlertas, vista: 'alertas' }
  ]);
  servidor.sembrar('suscripciones_push', [
    { usuario_id: admin, endpoint: 'e-admin' },
    { usuario_id: supervisorConAlertas, endpoint: 'e-sup1' },
    { usuario_id: supervisorSinAlertas, endpoint: 'e-sup2' },
    { usuario_id: operario, endpoint: 'e-op1' }
  ]);

  // Solo administradores/supervisores CON permiso de alertas (el super admin siempre pasa).
  const destinos = await repo.dispositivos({
    roles: ['supervisor', 'administrador', 'super_administrador'],
    requiereVista: 'alertas'
  });
  assert.deepEqual(destinos.map((d) => d.endpoint).sort(), ['e-admin', 'e-sup1']);

  // Por usuario concreto.
  const soloOperario = await repo.dispositivos({ usuarioIds: [operario] });
  assert.deepEqual(
    soloOperario.map((d) => d.endpoint),
    ['e-op1']
  );

  // Sin ningún criterio: no trae nada (evita mandar a todo el mundo por error).
  assert.deepEqual(await repo.dispositivos({}), []);
});

test('eliminarPorId olvida un dispositivo (equipo desinstalado)', async () => {
  const { repo, servidor } = montar();
  const [id] = servidor.sembrar('suscripciones_push', [{ usuario_id: 'u1', endpoint: 'e1' }]);
  await repo.eliminarPorId(id);
  assert.equal(servidor.leerTabla('suscripciones_push').length, 0);
});
