// Pruebas del importador de operarios (scripts/importar-operarios.js): solo el lector de CSV, sin base de datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { leerCsv, prepararOperarios } = require('../scripts/importar-operarios');

test('lee CSV con coma o punto y coma, comillas y BOM', () => {
  const a = prepararOperarios(
    leerCsv('\uFEFFnombre,cedula\n"PEREZ, JUAN",1001\nana  gomez,"1.002"\n')
  );
  assert.deepEqual(a.validos, [
    { nombre: 'PEREZ, JUAN', cedula: '1001' },
    { nombre: 'ANA GOMEZ', cedula: '1002' }
  ]);
  const b = prepararOperarios(leerCsv('nombre;cedula\r\nLUIS;77\r\n'));
  assert.deepEqual(b.validos, [{ nombre: 'LUIS', cedula: '77' }]);
});

test('descarta filas incompletas y cédulas repetidas, y avisa', () => {
  const r = prepararOperarios(leerCsv('nombre,cedula\nA,1\n,2\nB,\nC,1\n'));
  assert.equal(r.validos.length, 1);
  assert.equal(r.problemas.length, 3);
});

test('exige las columnas nombre y cedula', () => {
  assert.throws(() => prepararOperarios(leerCsv('a,b\n1,2\n')), /nombre.*cedula/);
});
