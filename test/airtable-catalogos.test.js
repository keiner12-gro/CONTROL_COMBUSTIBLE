// ============================================================================
// airtable-catalogos.test.js — PRUEBAS DE TRACTORES Y OPERARIOS EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const {
  AirtableTractorRepository
} = require('../src/tractors/infrastructure/airtable-tractor.repository');
const {
  AirtableOperatorRepository
} = require('../src/operators/infrastructure/airtable-operator.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return {
    servidor,
    tractores: new AirtableTractorRepository(cliente),
    operarios: new AirtableOperatorRepository(cliente)
  };
}

test('tractores: create asigna el item siguiente (incluso contando anulados) y normaliza mayúsculas', async () => {
  const { tractores } = montar();
  const t1 = await tractores.create({
    maquina: 'ma65',
    descripcion: 'tractor kubota',
    centro_costo: 'cc1',
    capacidad_galones: '29.1'
  });
  assert.equal(t1.item, 1);
  assert.equal(t1.maquina, 'MA65');
  await tractores.remove(t1.id, 'motivo', 'admin');
  const t2 = await tractores.create({
    maquina: 'ma70',
    descripcion: 'x',
    centro_costo: 'cc1',
    capacidad_galones: 10
  });
  assert.equal(t2.item, 2); // No reutiliza el 1, aunque esté anulado
});

test('tractores: list excluye anulados; findByMachine no distingue mayúsculas', async () => {
  const { tractores } = montar();
  await tractores.create({
    maquina: 'MA65',
    descripcion: 'x',
    centro_costo: 'c',
    capacidad_galones: 1
  });
  const anulado = await tractores.create({
    maquina: 'MA70',
    descripcion: 'x',
    centro_costo: 'c',
    capacidad_galones: 1
  });
  await tractores.remove(anulado.id, 'motivo', 'admin');
  assert.equal((await tractores.list()).length, 1);
  assert.equal((await tractores.findByMachine('ma65')).maquina, 'MA65');
  assert.equal(await tractores.findByMachine('no-existe'), null);
});

test('tractores: update cambia los datos; remove es idempotente (false la segunda vez)', async () => {
  const { tractores } = montar();
  const t = await tractores.create({
    maquina: 'MA65',
    descripcion: 'x',
    centro_costo: 'c',
    capacidad_galones: 1
  });
  const editado = await tractores.update(t.id, {
    maquina: 'MA65B',
    descripcion: 'y',
    centro_costo: 'c2',
    capacidad_galones: 5
  });
  assert.equal(editado.maquina, 'MA65B');
  assert.equal(editado.item, t.item); // El item no cambia al editar
  assert.equal(await tractores.update('rec-no-existe', { maquina: 'x' }), null);
  assert.equal(await tractores.remove(t.id, 'motivo', 'admin'), true);
  assert.equal(await tractores.remove(t.id, 'motivo', 'admin'), false);
});

test('operarios: create, list (sin anulados) y remove', async () => {
  const { operarios } = montar();
  const o = await operarios.create({ nombre: 'juan perez', cedula: '1001' });
  assert.equal(o.nombre, 'JUAN PEREZ');
  const o2 = await operarios.create({ nombre: 'ana gomez', cedula: '1002' });
  await operarios.remove(o2.id, 'motivo', 'admin');
  const lista = await operarios.list();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nombre, 'JUAN PEREZ');
});
