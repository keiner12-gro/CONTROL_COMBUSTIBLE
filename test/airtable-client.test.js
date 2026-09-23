// ============================================================================
// airtable-client.test.js — PRUEBAS DEL CLIENTE HTTP DE AIRTABLE
// ----------------------------------------------------------------------------
// Usan el servidor de Airtable falso (test/helpers/fake-airtable.js): no
// necesitan una cuenta real de Airtable.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function cliente(servidor) {
  return crearClienteAirtable({
    apiKey: 'clave-falsa',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
}

test('crear/listar/obtener/actualizar/eliminar de punta a punta', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);

  const [creado] = await c.crear('operarios', [{ nombre: 'JUAN', cedula: '1001' }]);
  assert.match(creado.id, /^rec/);
  assert.equal(creado.nombre, 'JUAN');

  const obtenido = await c.obtener('operarios', creado.id);
  assert.equal(obtenido.cedula, '1001');
  assert.equal(await c.obtener('operarios', 'rec-no-existe'), null);

  const [actualizado] = await c.actualizar('operarios', [
    { id: creado.id, campos: { cedula: '9999' } }
  ]);
  assert.equal(actualizado.cedula, '9999');

  const listado = await c.listar('operarios');
  assert.equal(listado.length, 1);

  await c.eliminar('operarios', [creado.id]);
  assert.equal((await c.listar('operarios')).length, 0);
});

test('los lotes de escritura se parten en grupos de 10', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);
  const filas = Array.from({ length: 23 }, (_, i) => ({ nombre: 'N' + i }));

  const creadas = await c.crear('operarios', filas);
  assert.equal(creadas.length, 23);
  const llamadasCreacion = servidor.peticiones.filter(
    (p) => p.metodo === 'POST' && p.url.includes('/operarios')
  ).length;
  assert.equal(llamadasCreacion, 3); // 10 + 10 + 3

  await c.eliminar(
    'operarios',
    creadas.map((f) => f.id)
  );
  assert.equal((await c.listar('operarios')).length, 0);
});

test('listar recorre la paginación sola (más de 100 filas)', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);
  servidor.sembrar(
    'operarios',
    Array.from({ length: 230 }, (_, i) => ({ nombre: 'N' + i }))
  );

  const todas = await c.listar('operarios');
  assert.equal(todas.length, 230);
});

test('reintenta cuando Airtable responde 429 y luego funciona', async () => {
  const servidor = crearAirtableFalso();
  let intentos = 0;
  const original = servidor.fetch;
  servidor.fetch = async (url, opciones) => {
    if (url.includes('/operarios') && (opciones.method || 'GET') === 'GET' && ++intentos === 1)
      return { ok: false, status: 429, json: async () => ({}), text: async () => '' };
    return original(url, opciones);
  };
  const c = cliente(servidor);
  servidor.sembrar('operarios', [{ nombre: 'X' }]);
  const filas = await c.listar('operarios');
  assert.equal(filas.length, 1);
  assert.ok(intentos >= 2);
});

test('transaction: si algo falla a mitad de camino, se deshace lo creado y lo editado', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);
  const [previo] = await c.crear('tractores', [{ maquina: 'MA1', capacidad_galones: 10 }]);

  await assert.rejects(
    c.transaction(async (tx) => {
      await tx.crear('operarios', [{ nombre: 'TEMPORAL' }]); // Esto debe desaparecer
      await tx.actualizar('tractores', [{ id: previo.id, campos: { capacidad_galones: 999 } }]); // Esto debe volver a 10
      throw new Error('fallo a propósito');
    })
  );

  assert.equal((await c.listar('operarios')).length, 0);
  const tractorFinal = await c.obtener('tractores', previo.id);
  assert.equal(tractorFinal.capacidad_galones, 10);
});

test('transaction: si todo sale bien, no se deshace nada', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);
  const resultado = await c.transaction(async (tx) => {
    const [creado] = await tx.crear('operarios', [{ nombre: 'PERMANENTE' }]);
    return creado.id;
  });
  assert.ok(resultado);
  assert.equal((await c.listar('operarios')).length, 1);
});

test('subirAdjunto guarda el archivo y queda accesible en el campo', async () => {
  const servidor = crearAirtableFalso();
  const c = cliente(servidor);
  const [fila] = await c.crear('soportes_combustible', [
    { nombre: 'x.pdf', tipo: 'application/pdf' }
  ]);
  await c.subirAdjunto('soportes_combustible', fila.id, 'archivo', {
    nombre: 'x.pdf',
    tipo: 'application/pdf',
    contenidoBase64: Buffer.from('%PDF-1.4').toString('base64')
  });
  const actualizada = await c.obtener('soportes_combustible', fila.id);
  assert.equal(actualizada.archivo.length, 1);
  assert.equal(actualizada.archivo[0].filename, 'x.pdf');
});

// Bases armadas a mano en Airtable: las relaciones (usuario_id...) pueden ser
// "Link to another record" y la tabla puede tener una columna "id" propia.
async function definirTabla(servidor, name, fields) {
  await servidor.fetch(`https://api.airtable.com/v0/meta/bases/${servidor.baseId}/tables`, {
    method: 'POST',
    body: JSON.stringify({ name, fields })
  });
}

test('columnas de enlace: se leen como "rec..." y se guardan como ["rec..."]', async () => {
  const servidor = crearAirtableFalso();
  await definirTabla(servidor, 'permisos_usuarios_combustible', [
    { name: 'usuario_id', type: 'multipleRecordLinks' },
    { name: 'vista', type: 'singleLineText' }
  ]);
  const c = cliente(servidor);

  const [creado] = await c.crear('permisos_usuarios_combustible', [
    { usuario_id: 'recUsuario1', vista: 'registro' }
  ]);
  assert.deepEqual(servidor.leerTabla('permisos_usuarios_combustible')[0].usuario_id, [
    'recUsuario1'
  ]);
  assert.equal(creado.usuario_id, 'recUsuario1');
  assert.equal((await c.listar('permisos_usuarios_combustible'))[0].usuario_id, 'recUsuario1');
  assert.equal((await c.obtener('permisos_usuarios_combustible', creado.id)).usuario_id, 'recUsuario1');

  await c.actualizar('permisos_usuarios_combustible', [{ id: creado.id, campos: { usuario_id: null } }]);
  assert.deepEqual(servidor.leerTabla('permisos_usuarios_combustible')[0].usuario_id, []);
});

test('columnas de texto no se tocan (base creada con airtable:migrar)', async () => {
  const servidor = crearAirtableFalso();
  await definirTabla(servidor, 'permisos_usuarios_combustible', [
    { name: 'usuario_id', type: 'singleLineText' },
    { name: 'vista', type: 'singleLineText' }
  ]);
  const c = cliente(servidor);

  await c.crear('permisos_usuarios_combustible', [{ usuario_id: 'recUsuario1', vista: 'registro' }]);
  assert.equal(servidor.leerTabla('permisos_usuarios_combustible')[0].usuario_id, 'recUsuario1');
});

test('una columna "id" de la base no reemplaza el id de Airtable', async () => {
  const servidor = crearAirtableFalso();
  const [idReal] = servidor.sembrar('operarios', [{ id: 22, nombre: 'JUAN' }]);
  const c = cliente(servidor);

  const [fila] = await c.listar('operarios');
  assert.equal(fila.id, idReal);
  assert.equal((await c.obtener('operarios', idReal)).nombre, 'JUAN');
});
