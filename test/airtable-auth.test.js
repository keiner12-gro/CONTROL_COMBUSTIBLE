// ============================================================================
// airtable-auth.test.js — PRUEBAS DEL REPOSITORIO DE SESIONES/LOGIN EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { AirtableAuthRepository } = require('../src/shared/infrastructure/airtable-auth.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableAuthRepository(cliente) };
}

test('crearSesion + buscarSesionConPermisos: trae el usuario y sus permisos', async () => {
  const { repo, servidor } = montar();
  const [usuarioId] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'juan', rol: 'supervisor', debe_cambiar_contrasena: false }
  ]);
  servidor.sembrar('permisos_usuarios_combustible', [
    { usuario_id: usuarioId, vista: 'registro' },
    { usuario_id: usuarioId, vista: 'alertas' }
  ]);

  await repo.crearSesion({
    tokenHash: 'hash1',
    usuarioId,
    expiraEn: new Date(Date.now() + 3600000),
    ip: '1.1.1.1',
    agente: 'chrome'
  });
  const sesion = await repo.buscarSesionConPermisos('hash1');
  assert.equal(sesion.usuarioId, usuarioId);
  assert.equal(sesion.usuario, 'juan');
  assert.equal(sesion.rol, 'supervisor');
  assert.deepEqual(sesion.permisos.sort(), ['alertas', 'registro']);
  assert.equal(sesion.marcarUso, true); // Nunca se ha usado
});

test('una sesión vencida no se encuentra', async () => {
  const { repo, servidor } = montar();
  const [usuarioId] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'juan', rol: 'operario' }
  ]);
  await repo.crearSesion({
    tokenHash: 'hash1',
    usuarioId,
    expiraEn: new Date(Date.now() - 1000),
    ip: '',
    agente: ''
  });
  assert.equal(await repo.buscarSesionConPermisos('hash1'), null);
});

test('un token que no existe no se encuentra', async () => {
  const { repo } = montar();
  assert.equal(await repo.buscarSesionConPermisos('no-existe'), null);
});

test('marcarUltimoUso actualiza la fecha; eliminarSesionPorToken la borra', async () => {
  const { repo, servidor } = montar();
  const [usuarioId] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'juan', rol: 'operario' }
  ]);
  await repo.crearSesion({
    tokenHash: 'hash1',
    usuarioId,
    expiraEn: new Date(Date.now() + 3600000),
    ip: '',
    agente: ''
  });
  await repo.marcarUltimoUso('hash1');
  assert.ok(servidor.leerTabla('sesiones_combustible')[0].ultimo_uso);
  await repo.eliminarSesionPorToken('hash1');
  assert.equal(servidor.leerTabla('sesiones_combustible').length, 0);
});

test('crearSesion limpia las sesiones vencidas de paso', async () => {
  const { repo, servidor } = montar();
  const [usuarioId] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'juan', rol: 'operario' }
  ]);
  servidor.sembrar('sesiones_combustible', [
    {
      token_hash: 'vieja',
      usuario_id: usuarioId,
      expira_en: new Date(Date.now() - 1000).toISOString()
    }
  ]);
  await repo.crearSesion({
    tokenHash: 'nueva',
    usuarioId,
    expiraEn: new Date(Date.now() + 3600000),
    ip: '',
    agente: ''
  });
  const restantes = servidor.leerTabla('sesiones_combustible').map((s) => s.token_hash);
  assert.deepEqual(restantes, ['nueva']);
});

test('la caché de usuario+permisos evita llamadas repetidas (dentro de la ventana)', async () => {
  const { repo, servidor } = montar();
  const [usuarioId] = servidor.sembrar('usuarios_combustible', [
    { usuario: 'juan', rol: 'operario' }
  ]);
  await repo.crearSesion({
    tokenHash: 'h1',
    usuarioId,
    expiraEn: new Date(Date.now() + 3600000),
    ip: '',
    agente: ''
  });
  await repo.crearSesion({
    tokenHash: 'h2',
    usuarioId,
    expiraEn: new Date(Date.now() + 3600000),
    ip: '',
    agente: ''
  });

  await repo.buscarSesionConPermisos('h1');
  const peticionesAntes = servidor.peticiones.length;
  await repo.buscarSesionConPermisos('h2'); // Mismo usuario: no debe volver a pedir usuario/permisos
  const peticionesDespues = servidor.peticiones.length;
  // Solo se hizo 1 petición más (la de buscar la sesión h2), no 3.
  assert.equal(peticionesDespues - peticionesAntes, 1);
});

test('intentos de login: cuenta, resetea si pasó la ventana, y se puede limpiar', async () => {
  const { repo } = montar();
  assert.equal(await repo.obtenerIntento('ip:usuario'), null);
  await repo.registrarIntentoFallido('ip:usuario', 900);
  let intento = await repo.obtenerIntento('ip:usuario');
  assert.equal(intento.intentos, 1);
  await repo.registrarIntentoFallido('ip:usuario', 900);
  intento = await repo.obtenerIntento('ip:usuario');
  assert.equal(intento.intentos, 2);

  await repo.limpiarIntento('ip:usuario');
  assert.equal(await repo.obtenerIntento('ip:usuario'), null);
});

test('intentos de login: si la ventana ya venció, se reinicia en 1', async () => {
  const { repo, servidor } = montar();
  servidor.sembrar('intentos_login_combustible', [
    {
      clave: 'ip:usuario',
      intentos: 8,
      primer_intento: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    } // hace 20 min
  ]);
  await repo.registrarIntentoFallido('ip:usuario', 900); // ventana de 15 min ya pasó
  const intento = await repo.obtenerIntento('ip:usuario');
  assert.equal(intento.intentos, 1);
});
