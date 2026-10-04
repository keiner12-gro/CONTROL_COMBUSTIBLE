// ============================================================================
// horometro.test.js — REGLA DE HORAS TRABAJADAS (src/records/domain/horometro.js)
// ----------------------------------------------------------------------------
// Tope de 24 h por día en cada tramo, horómetro dañado, horómetro que baja y
// galones por hora.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularHorometro } = require('../src/records/domain/horometro');

const t = (fecha, horometro, cantidad, registradoEn = '') => ({
  fecha,
  horometro,
  cantidad,
  registradoEn
});

test('tramos normales: horas = diferencia y gal/hora sin la primera carga', () => {
  const r = calcularHorometro([
    t('2026-09-24', '1437.8', 19.3),
    t('2026-09-25', '1444.2', 15.4),
    t('2026-10-01', '1480.9', 11.5),
    t('2026-10-02', '1487.9', 17.8)
  ]);
  assert.equal(r.horometroInicial, 1437.8);
  assert.equal(r.horometroFinal, 1487.9);
  assert.equal(r.horasTrabajadas, 50.1);
  assert.equal(r.galonesPorHora, 0.89); // (15.4 + 11.5 + 17.8) / 50.1
  assert.equal(r.tramosAjustados, 0);
});

test('tope de 24 h por día: 331.7 h en 7 días se ajusta a 168 h', () => {
  const r = calcularHorometro([t('2026-09-25', '7505', 10), t('2026-10-02', '7836.7', 12)]);
  assert.equal(r.horasTrabajadas, 168);
  assert.equal(r.tramosAjustados, 1);
  assert.equal(r.tanqueos[1].horasHorometro, 331.7);
  assert.equal(r.tanqueos[1].topeHoras, 168);
  assert.equal(r.tanqueos[1].ajustado, true);
});

test('varios tramos el mismo día se reparten las 24 h de ese día', () => {
  const r = calcularHorometro([
    t('2026-09-24', '100', 5, '2026-09-24T06:00:00Z'),
    t('2026-09-24', '115', 5, '2026-09-24T10:00:00Z'), // 15 h
    t('2026-09-24', '140', 5, '2026-09-24T16:00:00Z') // 25 h, pero solo quedan 9 h del día
  ]);
  assert.equal(r.tanqueos[1].horasTramo, 15);
  assert.equal(r.tanqueos[2].topeHoras, 9);
  assert.equal(r.tanqueos[2].horasTramo, 9);
  assert.equal(r.horasTrabajadas, 24);
});

test('mismo día o día siguiente: el tope mínimo es 24 h', () => {
  const r = calcularHorometro([
    t('2026-09-24', '100', 5, '2026-09-24T07:00:00Z'),
    t('2026-09-24', '150', 5, '2026-09-24T15:00:00Z')
  ]);
  assert.equal(r.horasTrabajadas, 24);
  assert.equal(r.tanqueos[1].topeHoras, 24);
});

test('horómetro dañado: se salta y el tramo se mide contra la última lectura válida', () => {
  // Del 01 al 09 (8 días) el horómetro estuvo dañado: tope 8 x 24 = 192 h.
  const r = calcularHorometro([
    t('2026-10-01', '1000', 10),
    t('2026-10-04', 'Horometro dañado', 8),
    t('2026-10-09', '1300', 20)
  ]);
  assert.equal(r.tanqueos[1].horasTramo, null); // La carga sin lectura no forma tramo
  assert.equal(r.tanqueos[2].horasHorometro, 300);
  assert.equal(r.tanqueos[2].topeHoras, 192);
  assert.equal(r.horasTrabajadas, 192);
  assert.equal(r.galonesPorHora, Math.round((20 / 192) * 100) / 100);
});

test('si el horómetro baja (cambio o reinicio) el tramo cuenta 0 h', () => {
  const r = calcularHorometro([t('2026-10-01', '500', 10), t('2026-10-03', '20', 10)]);
  assert.equal(r.tanqueos[1].retrocede, true);
  assert.equal(r.horasTrabajadas, 0);
  assert.equal(r.galonesPorHora, null);
  assert.equal(r.tramosQueRetroceden, 1);
});

test('sin lecturas numéricas o con una sola lectura no hay horas', () => {
  assert.equal(calcularHorometro([t('2026-10-01', 'No marca', 5)]).horasTrabajadas, null);
  const una = calcularHorometro([t('2026-10-01', '900', 5)]);
  assert.equal(una.horometroInicial, 900);
  assert.equal(una.horasTrabajadas, null);
});
