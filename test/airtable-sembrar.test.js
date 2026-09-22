// ============================================================================
// airtable-sembrar.test.js — PRUEBAS DE LOS DATOS INICIALES (npm run airtable:sembrar)
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { sembrar } = require('../scripts/airtable-sembrar');
const { crearAirtableFalso } = require('./helpers/fake-airtable');
const { verifyPassword } = require('../src/shared/infrastructure/security');

function montar() {
  const servidor = crearAirtableFalso();
  return {
    servidor,
    cliente: crearClienteAirtable({
      apiKey: 'x',
      baseId: servidor.baseId,
      fetchImpl: servidor.fetch
    })
  };
}

test('sin ADMIN_USUARIO/ADMIN_CONTRASENA: carga las máquinas pero no crea usuario', async () => {
  delete process.env.ADMIN_USUARIO;
  delete process.env.ADMIN_CONTRASENA;
  const { servidor, cliente } = montar();
  await sembrar(cliente);
  assert.ok(servidor.leerTabla('tractores').length > 0);
  assert.equal(servidor.leerTabla('usuarios_combustible').length, 0);
});

test('con ADMIN_USUARIO/ADMIN_CONTRASENA: crea el super administrador con la clave cifrada', async () => {
  process.env.ADMIN_USUARIO = 'admin';
  process.env.ADMIN_CONTRASENA = 'clave-temporal-larga';
  const { servidor, cliente } = montar();
  await sembrar(cliente);
  const [usuario] = servidor.leerTabla('usuarios_combustible');
  assert.equal(usuario.usuario, 'admin');
  assert.equal(usuario.rol, 'super_administrador');
  assert.equal(usuario.debe_cambiar_contrasena, true);
  assert.match(usuario.contrasena, /^scrypt\$/);
  assert.ok(verifyPassword('clave-temporal-larga', usuario.contrasena));
});

test('es seguro repetirlo: no duplica ni las máquinas ni el usuario', async () => {
  process.env.ADMIN_USUARIO = 'admin';
  process.env.ADMIN_CONTRASENA = 'clave-temporal-larga';
  const { servidor, cliente } = montar();
  await sembrar(cliente);
  const totalMaquinas = servidor.leerTabla('tractores').length;
  await sembrar(cliente);
  assert.equal(servidor.leerTabla('tractores').length, totalMaquinas);
  assert.equal(servidor.leerTabla('usuarios_combustible').length, 1);
});
