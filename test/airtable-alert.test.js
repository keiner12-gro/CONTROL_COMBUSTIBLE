// ============================================================================
// airtable-alert.test.js — PRUEBAS DEL REPOSITORIO DE ALERTAS EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const {
  AirtableAlertRepository
} = require('../src/alerts/infrastructure/airtable-alert.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableAlertRepository(cliente) };
}

test('create: guarda la alerta y una notificación por cada rol', async () => {
  const { repo, servidor } = montar();
  const alerta = await repo.create({
    registroId: 'rec1',
    fecha: '2026-09-01',
    maquina: 'MA65',
    operario: 'JUAN',
    cantidad: 40,
    capacidadGalones: 29.1,
    excesoGalones: 10.9,
    tipoAlerta: 'sobrecapacidad'
  });
  assert.equal(alerta.nueva, true);
  assert.equal(alerta.tipoAlerta, 'sobrecapacidad');
  const notificaciones = servidor.leerTabla('notificaciones_combustible');
  assert.equal(notificaciones.length, 3);
  assert.deepEqual(notificaciones.map((n) => n.rol).sort(), [
    'administrador',
    'super_administrador',
    'supervisor'
  ]);
  assert.match(notificaciones[0].mensaje, /MA65/);
});

test('findByRegistro / findByJornada: localizan la alerta por tipo', async () => {
  const { repo } = montar();
  const a = await repo.create({
    registroId: 'rec1',
    fecha: '2026-09-01',
    maquina: 'MA65',
    cantidad: 1,
    tipoAlerta: 'promedio'
  });
  assert.equal((await repo.findByRegistro('rec1', 'promedio')).id, a.id);
  assert.equal(await repo.findByRegistro('rec1', 'sobrecapacidad'), null);

  const b = await repo.create({
    jornadaId: 'j1',
    fecha: '2026-09-01',
    maquina: 'Cierre de día',
    cantidad: 0,
    tipoAlerta: 'cierre_pendiente'
  });
  assert.equal((await repo.findByJornada('j1', 'cierre_pendiente')).id, b.id);
});

test('resolverPorJornada: justifica las alertas de ese tipo y marca leídas sus notificaciones', async () => {
  const { repo, servidor } = montar();
  const a = await repo.create({
    jornadaId: 'j1',
    fecha: '2026-09-01',
    maquina: 'Cierre de día',
    cantidad: 0,
    tipoAlerta: 'cierre_pendiente'
  });
  const resueltas = await repo.resolverPorJornada('j1', 'cierre_pendiente', 'admin');
  assert.equal(resueltas, 1);
  const alertaFinal = await repo.findById(a.id);
  assert.equal(alertaFinal.estado, 'justificada');
  assert.equal(alertaFinal.justificacion, 'Jornada cerrada.');
  const notifs = servidor
    .leerTabla('notificaciones_combustible')
    .filter((n) => n.alerta_id === a.id);
  assert.ok(notifs.every((n) => n.leida === true));
});

test('update: solo la lista blanca de campos de justificación', async () => {
  const { repo } = montar();
  const a = await repo.create({
    registroId: 'r1',
    fecha: '2026-09-01',
    maquina: 'MA65',
    cantidad: 1,
    tipoAlerta: 'sobrecapacidad'
  });
  assert.equal(await repo.update(a.id, {}), false);
  assert.equal(await repo.update(a.id, { justificacion: 'motivo', estado: 'justificada' }), true);
  const fila = await repo.findById(a.id);
  assert.equal(fila.justificacion, 'motivo');
  assert.equal(fila.estado, 'justificada');
});

test('listNotifications: no leídas primero; markNotification respeta el rol', async () => {
  const { repo, servidor } = montar();
  await repo.create({
    registroId: 'r1',
    fecha: '2026-09-01',
    maquina: 'MA65',
    cantidad: 1,
    tipoAlerta: 'sobrecapacidad'
  });
  const notifs = await repo.listNotifications('supervisor');
  assert.equal(notifs.length, 1);
  await repo.markNotification(notifs[0].id, 'administrador'); // Rol equivocado: no debe marcarla
  assert.equal(
    servidor.leerTabla('notificaciones_combustible').find((n) => n.id === notifs[0].id).leida,
    false
  );
  await repo.markNotification(notifs[0].id, 'supervisor');
  assert.equal(
    servidor.leerTabla('notificaciones_combustible').find((n) => n.id === notifs[0].id).leida,
    true
  );
});

test('markNotificationsForAlert: marca todos los roles de una alerta', async () => {
  const { repo, servidor } = montar();
  const a = await repo.create({
    registroId: 'r1',
    fecha: '2026-09-01',
    maquina: 'MA65',
    cantidad: 1,
    tipoAlerta: 'sobrecapacidad'
  });
  await repo.markNotificationsForAlert(a.id);
  assert.ok(servidor.leerTabla('notificaciones_combustible').every((n) => n.leida === true));
});

test('listByDateRange: ordenado por fecha', async () => {
  const { repo } = montar();
  await repo.create({
    registroId: 'r2',
    fecha: '2026-09-03',
    maquina: 'X',
    cantidad: 1,
    tipoAlerta: 'sobrecapacidad'
  });
  await repo.create({
    registroId: 'r1',
    fecha: '2026-09-01',
    maquina: 'X',
    cantidad: 1,
    tipoAlerta: 'sobrecapacidad'
  });
  const lista = await repo.listByDateRange('2026-09-01', '2026-09-02');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].fecha, '2026-09-01');
});
