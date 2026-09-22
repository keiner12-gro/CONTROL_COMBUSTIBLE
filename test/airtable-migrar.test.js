// ============================================================================
// airtable-migrar.test.js — PRUEBAS DEL APROVISIONAMIENTO (npm run airtable:migrar)
// ============================================================================

process.env.AIRTABLE_API_KEY = 'clave-falsa';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../scripts/airtable-migrar');
const { TABLAS } = require('../airtable/schema');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

test('crea todas las tablas del esquema en una base vacía', async () => {
  const servidor = crearAirtableFalso();
  process.env.AIRTABLE_BASE_ID = servidor.baseId;
  await main({ fetchImpl: servidor.fetch });

  const meta = await (
    await servidor.fetch(`https://api.airtable.com/v0/meta/bases/${servidor.baseId}/tables`, {})
  ).json();
  assert.equal(meta.tables.length, Object.keys(TABLAS).length);
  const tabla = meta.tables.find((t) => t.name === 'jornadas_combustible');
  assert.equal(tabla.fields.length, TABLAS.jornadas_combustible.length);
});

test('es idempotente: correrlo dos veces no duplica columnas', async () => {
  const servidor = crearAirtableFalso();
  process.env.AIRTABLE_BASE_ID = servidor.baseId;
  await main({ fetchImpl: servidor.fetch });
  await main({ fetchImpl: servidor.fetch });

  const meta = await (
    await servidor.fetch(`https://api.airtable.com/v0/meta/bases/${servidor.baseId}/tables`, {})
  ).json();
  const tabla = meta.tables.find((t) => t.name === 'operarios');
  assert.equal(tabla.fields.length, TABLAS.operarios.length);
});

test('si la tabla ya existe pero le falta una columna nueva, solo agrega esa', async () => {
  const servidor = crearAirtableFalso();
  process.env.AIRTABLE_BASE_ID = servidor.baseId;
  // Se crea "operarios" a mano, con una sola columna (simula un esquema viejo).
  await servidor.fetch(`https://api.airtable.com/v0/meta/bases/${servidor.baseId}/tables`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'operarios',
      fields: [{ name: 'nombre', type: 'singleLineText' }]
    })
  });

  await main({ fetchImpl: servidor.fetch });

  const meta = await (
    await servidor.fetch(`https://api.airtable.com/v0/meta/bases/${servidor.baseId}/tables`, {})
  ).json();
  const operarios = meta.tables.find((t) => t.name === 'operarios');
  assert.equal(operarios.fields.length, TABLAS.operarios.length); // Se completaron las que faltaban
  const otras = meta.tables.filter((t) => t.name !== 'operarios');
  assert.equal(otras.length, Object.keys(TABLAS).length - 1); // Las demás sí se crearon completas
});

test('sin AIRTABLE_API_KEY/AIRTABLE_BASE_ID avisa con un error claro', async () => {
  delete process.env.AIRTABLE_BASE_ID;
  await assert.rejects(main({ fetchImpl: async () => {} }), /Faltan AIRTABLE_API_KEY/);
});
