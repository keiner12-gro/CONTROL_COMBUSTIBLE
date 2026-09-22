// ============================================================================
// airtable-record.test.js — PRUEBAS DEL REPOSITORIO DE SUMINISTROS EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const {
  AirtableRecordRepository
} = require('../src/records/infrastructure/airtable-record.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableRecordRepository(cliente) };
}

test('insert + list: solo se listan los activos, más recientes primero', async () => {
  const { repo } = montar();
  await repo.insert({ fecha: '2026-09-01', maquina: 'MA65', cantidad: 10, registradoPor: 'op' });
  await new Promise((r) => setTimeout(r, 5));
  const id2 = await repo.insert({
    fecha: '2026-09-02',
    maquina: 'MA65',
    cantidad: 20,
    registradoPor: 'op'
  });
  const anulado = await repo.insert({
    fecha: '2026-09-03',
    maquina: 'MA65',
    cantidad: 5,
    registradoPor: 'op'
  });
  await repo.remove(anulado, 'error de digitación', 'admin');

  const lista = await repo.list();
  assert.equal(lista.length, 2);
  assert.equal(lista[0].id, id2); // El más reciente primero
});

test('machineConsumptionStats: agrupa por máquina y cruza con la capacidad del tractor', async () => {
  const { repo, servidor } = montar();
  servidor.sembrar('tractores', [
    { maquina: 'MA65', capacidad_galones: 29.1, descripcion: 'TRACTOR' }
  ]);
  await repo.insert({ fecha: '2026-09-01', maquina: 'ma65', cantidad: 10 });
  await repo.insert({ fecha: '2026-09-02', maquina: 'MA65', cantidad: 20 });
  await repo.insert({ fecha: '2026-09-02', maquina: 'MA70', cantidad: 5 });

  const stats = await repo.machineConsumptionStats('2026-09-01', '2026-09-30');
  const ma65 = stats.find((s) => s.maquina.toUpperCase() === 'MA65');
  assert.equal(ma65.registros, 2);
  assert.equal(ma65.total_galones, 30);
  assert.equal(ma65.totalGalones, 30); // Formato dual (snake_case + camelCase)
  assert.equal(ma65.promedio_galones, 15);
  assert.equal(ma65.maximo_galones, 20);
  assert.equal(ma65.capacidad_galones, 29.1);
  assert.equal(ma65.descripcion, 'TRACTOR');
  assert.equal(stats[0].maquina.toUpperCase(), 'MA65'); // Ordenado por total descendente
});

test('averageQuantityByMachine: promedio histórico excluyendo el registro actual', async () => {
  const { repo } = montar();
  await repo.insert({ fecha: '2026-09-01', maquina: 'MA65', cantidad: 10 });
  const idActual = await repo.insert({ fecha: '2026-09-02', maquina: 'MA65', cantidad: 40 });

  const conExclusion = await repo.averageQuantityByMachine('MA65', idActual);
  assert.equal(conExclusion.muestras, 1);
  assert.equal(conExclusion.promedio, 10);

  const sinExclusion = await repo.averageQuantityByMachine('MA65');
  assert.equal(sinExclusion.muestras, 2);
  assert.equal(sinExclusion.promedio, 25);
});

test('latestHourmeter: ignora textos no numéricos y toma el mayor valor válido', async () => {
  const { repo } = montar();
  await repo.insert({ fecha: '2026-09-01', maquina: 'MA65', horometro: '100' });
  await repo.insert({ fecha: '2026-09-02', maquina: 'MA65', horometro: 'DAÑADO' });
  await repo.insert({ fecha: '2026-09-03', maquina: 'MA65', horometro: '120,5' });
  assert.equal(await repo.latestHourmeter('MA65'), 120.5);
  assert.equal(await repo.latestHourmeter('SIN-REGISTROS'), 0);
});

test('findByDateRange: filtra por texto en máquina u operario, sin distinguir mayúsculas', async () => {
  const { repo } = montar();
  await repo.insert({ fecha: '2026-09-01', maquina: 'MA65', operario: 'JUAN PEREZ' });
  await repo.insert({ fecha: '2026-09-02', maquina: 'MA70', operario: 'ANA GOMEZ' });

  const porMaquina = await repo.findByDateRange('2026-09-01', '2026-09-30', 'ma65');
  assert.equal(porMaquina.length, 1);
  assert.equal(porMaquina[0].maquina, 'MA65');

  const porOperario = await repo.findByDateRange('2026-09-01', '2026-09-30', 'gomez');
  assert.equal(porOperario.length, 1);
  assert.equal(porOperario[0].operario, 'ANA GOMEZ');
});

test('update: solo toca los campos de la lista blanca, y normaliza mayúsculas', async () => {
  const { repo } = montar();
  const id = await repo.insert({
    fecha: '2026-09-01',
    maquina: 'MA65',
    operario: 'juan',
    observaciones: 'ok'
  });
  assert.equal(await repo.update(id, { operario: 'pedro perez', rolNoPermitido: 'x' }), true);
  const fila = await repo.findById(id);
  assert.equal(fila.operario, 'PEDRO PEREZ');
  assert.equal(fila.observaciones, 'ok'); // No se tocó
  assert.equal(await repo.update(id, {}), false); // Nada válido: no hace nada
});

test('remove: anula una sola vez (la segunda vez devuelve false)', async () => {
  const { repo } = montar();
  const id = await repo.insert({ fecha: '2026-09-01', maquina: 'MA65' });
  assert.equal(await repo.remove(id, 'motivo', 'admin'), true);
  assert.equal((await repo.findById(id)).estado, 'ANULADO');
  assert.equal(await repo.remove(id, 'motivo', 'admin'), false);
});

test('summarizeByMonth: agrupa suministros por año/mes, sin contar los anulados', async () => {
  const { repo } = montar();
  await repo.insert({ fecha: '2026-09-01', maquina: 'MA65', cantidad: 10 });
  const id2 = await repo.insert({ fecha: '2026-09-15', maquina: 'MA65', cantidad: 20 });
  await repo.remove(id2, 'x', 'admin');
  const resumen = await repo.summarizeByMonth();
  const sep = resumen.find((r) => r.mes === 9);
  assert.equal(sep.total_registros, 1);
  assert.equal(sep.total_suministrado, 10);
});
