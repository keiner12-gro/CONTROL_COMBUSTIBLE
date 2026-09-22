// ============================================================================
// airtable-jornada.test.js — PRUEBAS DEL REPOSITORIO DE JORNADAS EN AIRTABLE
// ----------------------------------------------------------------------------
// Usan el Airtable falso (fetch en memoria): ejercitan el cliente real y las
// fórmulas reales, no una versión simplificada.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const {
  AirtableJornadaRepository
} = require('../src/jornadas/infrastructure/airtable-jornada.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar() {
  const servidor = crearAirtableFalso();
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableJornadaRepository(cliente) };
}

test('guardar: crea la jornada la primera vez y solo con los campos enviados', async () => {
  const { repo } = montar();
  const j = await repo.guardar('2026-09-01', { m1Inicial: 100, fugaBiodiesel: 'NO' }, 'op1');
  assert.equal(j.fecha, '2026-09-01');
  assert.equal(j.estado, 'abierta');
  assert.equal(j.m1_inicial, 100);
  assert.equal(j.fuga_biodiesel, 'NO');
  assert.equal(j.abierta_por, 'op1');
  assert.equal(j.m2_inicial ?? null, null); // No se envió, no debe inventarse
});

test('guardar: la segunda llamada del mismo día actualiza, no duplica', async () => {
  const { repo, servidor } = montar();
  await repo.guardar('2026-09-01', { m1Inicial: 100 }, 'op1');
  const j2 = await repo.guardar('2026-09-01', { m2Inicial: 200 }, 'op2');
  assert.equal(j2.m1_inicial, 100); // Lo anterior se conserva
  assert.equal(j2.m2_inicial, 200);
  assert.equal(j2.actualizada_por, 'op2');
  assert.equal(servidor.leerTabla('jornadas_combustible').length, 1); // Una sola fila
});

test('guardar: cerrar deja la jornada en estado cerrada, con quien y cuando', async () => {
  const { repo } = montar();
  await repo.guardar('2026-09-01', { m1Inicial: 100 }, 'op1');
  const cerrada = await repo.guardar('2026-09-01', { m1Final: 130 }, 'op1', { cerrar: true });
  assert.equal(cerrada.estado, 'cerrada');
  assert.equal(cerrada.cerrada_por, 'op1');
  assert.ok(cerrada.cerrada_en);
});

test('guardar: una jornada cerrada no se puede tocar de nuevo (devuelve null)', async () => {
  const { repo } = montar();
  await repo.guardar('2026-09-01', { m1Inicial: 100 }, 'op1');
  await repo.guardar('2026-09-01', { m1Final: 130 }, 'op1', { cerrar: true });
  const segundoCierre = await repo.guardar('2026-09-01', { m1Final: 999 }, 'op2', { cerrar: true });
  assert.equal(segundoCierre, null);
  const jornada = await repo.findByFecha('2026-09-01');
  assert.equal(jornada.m1_final, 130); // No se pisó
});

test('guardar: con permitirCerrada=true SÍ se puede corregir una jornada cerrada', async () => {
  const { repo } = montar();
  await repo.guardar('2026-09-01', { m1Inicial: 100 }, 'op1');
  await repo.guardar('2026-09-01', { m1Final: 130 }, 'op1', { cerrar: true });
  const corregida = await repo.guardar('2026-09-01', { m1Final: 135 }, 'admin', {
    permitirCerrada: true
  });
  assert.equal(corregida.m1_final, 135);
  assert.equal(corregida.estado, 'cerrada'); // Sigue cerrada
});

test('findByFecha / findById: encuentran y devuelven null si no existe', async () => {
  const { repo } = montar();
  const creada = await repo.guardar('2026-09-05', { m1Inicial: 1 }, 'op1');
  assert.equal((await repo.findByFecha('2026-09-05')).id, creada.id);
  assert.equal(await repo.findByFecha('2026-09-06'), null);
  assert.equal((await repo.findById(creada.id)).fecha, '2026-09-05');
});

test('listAbiertasHasta: solo trae las abiertas, hasta la fecha indicada', async () => {
  const { repo } = montar();
  await repo.guardar('2026-09-01', { m1Inicial: 1 }, 'op1');
  await repo.guardar('2026-09-02', { m1Inicial: 1 }, 'op1');
  await repo.guardar('2026-09-02', { m1Final: 5 }, 'op1', { cerrar: true }); // Esta sí se cierra
  await repo.guardar('2026-09-03', { m1Inicial: 1 }, 'op1');

  const abiertas = await repo.listAbiertasHasta('2026-09-02');
  assert.deepEqual(abiertas.map((j) => j.fecha).sort(), ['2026-09-01']);
});

test('listByDateRange: trae las jornadas del rango, ordenadas por fecha', async () => {
  const { repo } = montar();
  await repo.guardar('2026-09-03', { m1Inicial: 1 }, 'x');
  await repo.guardar('2026-09-01', { m1Inicial: 1 }, 'x');
  await repo.guardar('2026-09-02', { m1Inicial: 1 }, 'x');
  const rango = await repo.listByDateRange('2026-09-01', '2026-09-02');
  assert.deepEqual(
    rango.map((j) => j.fecha),
    ['2026-09-01', '2026-09-02']
  );
});

test('summarizeByMonth: suma los galones por año/mes', async () => {
  const { repo } = montar();
  await repo.guardar(
    '2026-09-01',
    { m1Inicial: 0, m1Final: 30, galonesM1: 30, totalGalones: 30 },
    'x',
    { cerrar: true }
  );
  await repo.guardar(
    '2026-09-05',
    { m1Inicial: 0, m1Final: 10, galonesM1: 10, totalGalones: 10 },
    'x',
    { cerrar: true }
  );
  await repo.guardar(
    '2026-10-01',
    { m1Inicial: 0, m1Final: 5, galonesM1: 5, totalGalones: 5 },
    'x',
    { cerrar: true }
  );
  const resumen = await repo.summarizeByMonth();
  const sep = resumen.find((r) => r.mes === 9 && r.anio === 2026);
  assert.equal(sep.total_surtidor, 40);
  assert.equal(sep.jornadas, 2);
});

test('countSuministros: cuenta los registros activos de esa fecha, no los anulados', async () => {
  const { repo, servidor } = montar();
  servidor.sembrar('registros_combustible', [
    { fecha: '2026-09-01', estado: 'ACTIVO' },
    { fecha: '2026-09-01', estado: 'ACTIVO' },
    { fecha: '2026-09-01', estado: 'ANULADO' },
    { fecha: '2026-09-02', estado: 'ACTIVO' }
  ]);
  assert.equal(await repo.countSuministros('2026-09-01'), 2);
  assert.equal(await repo.countSuministros('2026-09-09'), 0);
});

test('transaction: si algo falla después de crear la jornada, se deshace', async () => {
  const { repo } = montar();
  await assert.rejects(
    repo.transaction(async (tx) => {
      await repo.guardar('2026-09-20', { m1Inicial: 1 }, 'x', {}, tx);
      throw new Error('fallo');
    })
  );
  assert.equal(await repo.findByFecha('2026-09-20'), null);
});
