// ============================================================================
// airtable-user.test.js — PRUEBAS DEL REPOSITORIO DE USUARIOS EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { AirtableUserRepository } = require('../src/users/infrastructure/airtable-user.repository');
const { hashPassword } = require('../src/shared/infrastructure/security');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableUserRepository(cliente) };
}

test('create + findByCredentials: login correcto e incorrecto', async () => {
  const { repo } = montar();
  await repo.create({ usuario: 'Admin', contrasena: 'clave-1234', rol: 'super_administrador' });
  assert.ok(await repo.findByCredentials('admin', 'clave-1234')); // Sin distinguir mayúsculas
  assert.equal(await repo.findByCredentials('admin', 'mala'), null);
  assert.equal(await repo.findByCredentials('no-existe', 'x'), null);
});

test('create: no deja crear dos veces el mismo usuario (409)', async () => {
  const { repo } = montar();
  await repo.create({ usuario: 'juan', contrasena: 'clave-1234', rol: 'operario' });
  await assert.rejects(
    repo.create({ usuario: 'JUAN', contrasena: 'otra-clave', rol: 'operario' }),
    (e) => e.status === 409
  );
});

test('create: valida largo mínimo de usuario y contraseña', async () => {
  const { repo } = montar();
  await assert.rejects(
    repo.create({ usuario: 'ab', contrasena: 'clave-1234', rol: 'operario' }),
    /al menos 3/
  );
  await assert.rejects(
    repo.create({ usuario: 'usuario', contrasena: '123', rol: 'operario' }),
    /al menos 6/
  );
});

test('contraseña temporal "123456" obliga a cambiarla', async () => {
  const { repo } = montar();
  const id = await repo.create({ usuario: 'temporal', contrasena: '123456', rol: 'operario' });
  assert.equal((await repo.findById(id)).debe_cambiar_contrasena, true);
});

test('changePassword: exige la contraseña actual correcta y apaga la bandera', async () => {
  const { repo } = montar();
  const id = await repo.create({ usuario: 'usox', contrasena: '123456', rol: 'operario' });
  assert.equal(await repo.changePassword(id, 'mala', 'nueva-clave'), false);
  assert.equal(await repo.changePassword(id, '123456', 'nueva-clave'), true);
  assert.equal((await repo.findById(id)).debe_cambiar_contrasena, false);
  assert.ok(await repo.findByCredentials('usox', 'nueva-clave'));
});

test('replacePermissions + getPermissions: reemplaza y filtra por lista blanca', async () => {
  const { repo } = montar();
  const id = await repo.create({ usuario: 'usox', contrasena: 'clave-1234', rol: 'supervisor' });
  await repo.replacePermissions(id, ['registro', 'no-existe-esta-vista', 'alertas']);
  const permisos = await repo.getPermissions(id, 'supervisor');
  assert.deepEqual(permisos.sort(), ['alertas', 'registro']);
  await repo.replacePermissions(id, ['tablas']);
  assert.deepEqual(await repo.getPermissions(id, 'supervisor'), ['tablas']); // Se reemplazó, no se acumuló
});

test('remove: borra permisos/sesiones/push y deja la auditoría sin el enlace al usuario', async () => {
  const { repo, servidor } = montar();
  const id = await repo.create({ usuario: 'usox', contrasena: 'clave-1234', rol: 'operario' });
  await repo.replacePermissions(id, ['registro']);
  servidor.sembrar('sesiones_combustible', [{ usuario_id: id, token_hash: 'h' }]);
  servidor.sembrar('suscripciones_push', [{ usuario_id: id, endpoint: 'https://x' }]);
  servidor.sembrar('auditoria_combustible', [
    { usuario_id: id, usuario: 'usox', accion: 'LOGIN', modulo: 'usuarios' }
  ]);

  await repo.remove(id);

  assert.equal(await repo.findById(id), null);
  assert.equal(servidor.leerTabla('permisos_usuarios_combustible').length, 0);
  assert.equal(servidor.leerTabla('sesiones_combustible').length, 0);
  assert.equal(servidor.leerTabla('suscripciones_push').length, 0);
  const auditoria = servidor.leerTabla('auditoria_combustible')[0];
  assert.equal(auditoria.usuario, 'usox'); // El nombre se conserva
  assert.equal(auditoria.usuario_id, null); // Pero el enlace se rompe
});

test('list: el super administrador siempre ve todas las vistas disponibles', async () => {
  const { repo } = montar();
  await repo.create({ usuario: 'admin', contrasena: 'clave-1234', rol: 'super_administrador' });
  const [fila] = await repo.list();
  assert.ok(fila.permisos.includes('usuarios'));
  assert.ok(fila.permisos.includes('auditoria'));
});

test('migración: una contraseña vieja en texto plano se valida una vez y se cifra sola', async () => {
  const { repo, servidor } = montar();
  const [id] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'viejo', contrasena: 'texto-plano-123', rol: 'operario' }
  ]);
  const primero = await repo.findByCredentials('viejo', 'texto-plano-123');
  assert.ok(primero);
  const filaLuego = (await servidor.leerTabla('usuarios_combustible')).find((f) => f.id === id);
  assert.match(filaLuego.contrasena, /^scrypt\$/); // Ya quedó cifrada
});
