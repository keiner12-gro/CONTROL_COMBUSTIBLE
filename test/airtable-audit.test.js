// ============================================================================
// airtable-audit.test.js — PRUEBAS DEL REPOSITORIO DE AUDITORÍA EN AIRTABLE
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const {
  AirtableAuditRepository
} = require('../src/shared/infrastructure/airtable-audit.repository');
const { crearAirtableFalso } = require('./helpers/fake-airtable');

function montar(ahora) {
  const servidor = crearAirtableFalso({ ahora: () => ahora || new Date() });
  const cliente = crearClienteAirtable({
    apiKey: 'x',
    baseId: servidor.baseId,
    fetchImpl: servidor.fetch
  });
  return { servidor, repo: new AirtableAuditRepository(cliente) };
}

test('registrar + obtener: guarda el detalle como JSON de texto', async () => {
  const { repo, servidor } = montar();
  await repo.registrar({
    usuarioId: 'u1',
    usuario: 'juan',
    rol: 'operario',
    accion: 'CREAR',
    modulo: 'registros',
    registroId: 'r1',
    detalle: { maquina: 'MA65' }
  });
  const [fila] = servidor.leerTabla('auditoria_combustible');
  assert.equal(fila.accion, 'CREAR');
  assert.equal(fila.detalle, '{"maquina":"MA65"}');
  const obtenida = await repo.obtener(fila.id);
  assert.equal(obtenida.usuario, 'juan');
});

test('paginar: respeta el filtro exacto de acción/módulo y la paginación', async () => {
  const { repo } = montar();
  for (let i = 0; i < 5; i++)
    await repo.registrar({ usuario: 'juan', accion: 'CREAR', modulo: 'registros' });
  await repo.registrar({ usuario: 'juan', accion: 'EDITAR', modulo: 'registros' });
  await repo.registrar({ usuario: 'juan', accion: 'CREAR', modulo: 'tractores' });

  const { registros, total } = await repo.paginar({
    accion: 'CREAR',
    modulo: 'registros',
    pagina: 1,
    limite: 3
  });
  assert.equal(total, 5);
  assert.equal(registros.length, 3);
  const segunda = await repo.paginar({
    accion: 'CREAR',
    modulo: 'registros',
    pagina: 2,
    limite: 3
  });
  assert.equal(segunda.registros.length, 2);
});

test('paginar: usuario es búsqueda parcial, sin distinguir mayúsculas', async () => {
  const { repo } = montar();
  await repo.registrar({ usuario: 'Juan Perez', accion: 'CREAR', modulo: 'registros' });
  await repo.registrar({ usuario: 'Ana Gomez', accion: 'CREAR', modulo: 'registros' });
  const { total } = await repo.paginar({ usuario: 'perez', pagina: 1, limite: 20 });
  assert.equal(total, 1);
});

test('paginar: q busca en usuario, accion, modulo y detalle', async () => {
  const { repo } = montar();
  await repo.registrar({
    usuario: 'juan',
    accion: 'CREAR',
    modulo: 'registros',
    detalle: { maquina: 'MA65-ESPECIAL' }
  });
  await repo.registrar({ usuario: 'ana', accion: 'EDITAR', modulo: 'tractores' });
  assert.equal((await repo.paginar({ q: 'especial', pagina: 1, limite: 20 })).total, 1);
  assert.equal((await repo.paginar({ q: 'tractores', pagina: 1, limite: 20 })).total, 1);
  assert.equal((await repo.paginar({ q: 'no-existe-nada', pagina: 1, limite: 20 })).total, 0);
});

test('paginar: el rango de fechas se filtra en la zona horaria de la operación', async () => {
  process.env.ZONA_HORARIA = 'America/Bogota';
  const { repo, servidor } = montar();
  // 23:30 UTC del 31 de agosto = 18:30 en Bogotá (UTC-5): sigue siendo 31 de agosto local.
  servidor.sembrar('auditoria_combustible', [
    {
      usuario: 'juan',
      accion: 'CREAR',
      modulo: 'registros',
      creado_en: '2026-08-31T23:30:00.000Z'
    },
    { usuario: 'juan', accion: 'CREAR', modulo: 'registros', creado_en: '2026-09-01T06:00:00.000Z' } // 01:00 Bogotá: ya es 1 de septiembre
  ]);
  const soloAgosto = await repo.paginar({
    fechaDesde: '2026-08-31',
    fechaHasta: '2026-08-31',
    pagina: 1,
    limite: 20
  });
  assert.equal(soloAgosto.total, 1);
  const soloSeptiembre = await repo.paginar({
    fechaDesde: '2026-09-01',
    fechaHasta: '2026-09-01',
    pagina: 1,
    limite: 20
  });
  assert.equal(soloSeptiembre.total, 1);
});

test('resumen: cuenta valores únicos, no filas', async () => {
  const { repo } = montar();
  await repo.registrar({ usuario: 'juan', accion: 'CREAR', modulo: 'registros' });
  await repo.registrar({ usuario: 'juan', accion: 'EDITAR', modulo: 'registros' });
  await repo.registrar({ usuario: 'ana', accion: 'CREAR', modulo: 'tractores' });
  const resumen = await repo.resumen({});
  assert.equal(resumen.total_eventos, 3);
  assert.equal(resumen.usuarios_unicos, 2);
  assert.equal(resumen.acciones_unicas, 2);
  assert.equal(resumen.modulos_unicos, 2);
});

test('listarTodo: sin paginar, para exportar a CSV', async () => {
  const { repo } = montar();
  for (let i = 0; i < 4; i++)
    await repo.registrar({ usuario: 'juan', accion: 'CREAR', modulo: 'registros' });
  const todos = await repo.listarTodo({});
  assert.equal(todos.length, 4);
});
