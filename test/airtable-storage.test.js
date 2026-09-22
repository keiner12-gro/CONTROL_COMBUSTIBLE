// ============================================================================
// airtable-storage.test.js — PRUEBAS DE ALMACENAMIENTO DE ADJUNTOS EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { crearAlmacenamiento } = require('../src/shared/infrastructure/storage');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

test('guardar sube el archivo a Airtable y leer lo recupera igual', async () => {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  const almacenamiento = crearAlmacenamiento({
    fetchImpl: servidor.fetch,
    airtableClient: cliente
  });
  assert.equal(almacenamiento.usaAirtable, true);
  assert.equal(almacenamiento.usaSupabase, false);

  const pdf = Buffer.from('%PDF-1.4 contenido de prueba');
  const ruta = await almacenamiento.guardar(pdf, {
    nombre: 'reporte.pdf',
    tipo: 'application/pdf'
  });
  assert.match(ruta, /^at:rec/);

  const leido = await almacenamiento.leer(ruta);
  assert.ok(leido.buffer.equals(pdf));
});

test('leer devuelve null si la ruta "at:" no existe', async () => {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  const almacenamiento = crearAlmacenamiento({
    fetchImpl: servidor.fetch,
    airtableClient: cliente
  });
  assert.equal(await almacenamiento.leer('at:rec-no-existe'), null);
});

test('sin cliente de Airtable, una ruta "at:" no se puede leer (pero no revienta)', async () => {
  const almacenamiento = crearAlmacenamiento({});
  assert.equal(await almacenamiento.leer('at:recXXXX'), null);
});
