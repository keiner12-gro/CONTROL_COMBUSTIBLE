// ============================================================================
// migracion.test.js — PRUEBAS DE LA MIGRACIÓN DE DATOS (scripts/migrar-datos.js)
// ----------------------------------------------------------------------------
// Toman filas de ejemplo con la FORMA de la base antigua (todo mezclado en
// registros_combustible), las transforman y las escriben en un PostgreSQL
// embebido con el esquema nuevo. No necesitan la base real.
// ============================================================================

process.env.DB_DRIVER = 'pglite';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { crearBaseDeDatos } = require('../src/shared/infrastructure/db');
const { aplicarEsquema } = require('../scripts/db-migrar');
const { hashPassword, verifyPassword } = require('../src/shared/infrastructure/security');
const {
  transformar,
  escribir,
  verificar,
  subirAdjuntosViejos
} = require('../scripts/migrar-datos');

const fila = (extra) => ({
  cierre_dia: 0,
  estado: 'ACTIVO',
  m1_inicial: null,
  m1_final: null,
  m2_inicial: null,
  m2_final: null,
  galones_m1: null,
  galones_m2: null,
  total_galones: null,
  fuga_biodiesel: null,
  sistema_electrico: null,
  parada_emergencia: null,
  operario: null,
  cedula: null,
  maquina: null,
  horometro: null,
  cantidad: null,
  numero_sai: null,
  firma: null,
  observaciones: null,
  registrado_en: '2026-09-01 08:00:00',
  ...extra
});

// Base antigua de ejemplo: todo mezclado, con los casos raros que puede haber en producción.
const origen = {
  usuarios: [
    {
      id: 1,
      usuario: 'admin',
      contrasena: hashPassword('clave-admin'),
      rol: 'super_administrador',
      debe_cambiar_contrasena: 0,
      creado_en: '2026-08-01 10:00:00'
    },
    {
      id: 2,
      usuario: 'operario',
      contrasena: 'texto-plano-8',
      rol: 'operario',
      debe_cambiar_contrasena: 1,
      creado_en: '2026-08-02 10:00:00'
    }
  ],
  permisos: [
    { id: 1, usuario_id: 2, vista: 'registro', creado_en: '2026-08-02 10:00:00' },
    { id: 2, usuario_id: 99, vista: 'x', creado_en: null }
  ],
  tractores: [
    {
      id: 5,
      item: 1,
      maquina: 'MA65',
      descripcion: 'TRACTOR',
      centro_costo: '1',
      capacidad_galones: '29.10',
      estado: 'ACTIVO'
    }
  ],
  operarios: [
    {
      id: 7,
      nombre: 'JUAN PEREZ',
      cedula: '1001',
      estado: 'ACTIVO',
      creado_en: '2026-08-03 09:00:00'
    }
  ],
  registros: [
    // Día D1: un cierre, dos suministros y un segundo cierre duplicado (mayor id)
    fila({
      id: 1,
      fecha: '2026-09-01',
      cierre_dia: 1,
      m1_inicial: 100,
      m1_final: 130,
      m2_inicial: 200,
      m2_final: 210,
      galones_m1: 30,
      galones_m2: 10,
      total_galones: 40,
      fuga_biodiesel: 'NO',
      sistema_electrico: 'Buen estado',
      parada_emergencia: 'Buen estado'
    }),
    fila({
      id: 2,
      fecha: '2026-09-01',
      m1_inicial: 100,
      m2_inicial: 200,
      operario: 'JUAN PEREZ',
      maquina: 'MA65',
      cantidad: '20.00',
      numero_sai: 'S1',
      firma: 'data:image/png;base64,AA'
    }),
    fila({
      id: 3,
      fecha: '2026-09-01',
      operario: 'JUAN PEREZ',
      maquina: 'MA65',
      cantidad: '15.50'
    }),
    fila({
      id: 8,
      fecha: '2026-09-01',
      cierre_dia: 1,
      m1_inicial: 100,
      m1_final: 135,
      m2_inicial: 200,
      m2_final: 210,
      galones_m1: 35,
      galones_m2: 10,
      total_galones: 45,
      fuga_biodiesel: 'NO'
    }),
    // Un cierre anulado se ignora
    fila({
      id: 4,
      fecha: '2026-09-02',
      cierre_dia: 1,
      estado: 'ANULADO',
      m1_inicial: 1,
      m1_final: 2,
      m2_inicial: 1,
      m2_final: 2,
      total_galones: 2
    }),
    // Cierre histórico (cierre_dia=0 pero con las 4 lecturas y sin operario/máquina); su checklist estaba en un suministro
    fila({
      id: 5,
      fecha: '2026-09-03',
      m1_inicial: 10,
      m1_final: 20,
      m2_inicial: 30,
      m2_final: 35,
      galones_m1: 10,
      galones_m2: 5,
      total_galones: 15
    }),
    fila({
      id: 6,
      fecha: '2026-09-03',
      operario: 'JUAN PEREZ',
      maquina: 'MA65',
      cantidad: '4',
      fuga_biodiesel: 'SI',
      sistema_electrico: 'Mal',
      parada_emergencia: 'Buen estado'
    }),
    // Suministro sin fecha: no se puede migrar
    fila({ id: 7, fecha: null, operario: 'X', maquina: 'MA65', cantidad: '9' }),
    // Suministro anulado: se conserva como anulado
    fila({
      id: 9,
      fecha: '2026-09-03',
      operario: 'JUAN PEREZ',
      maquina: 'MA65',
      cantidad: '3',
      estado: 'ANULADO',
      motivo_anulacion: 'error'
    })
  ],
  alertas: [
    {
      id: 1,
      registro_id: 2,
      fecha: '2026-09-01',
      maquina: 'MA65',
      operario: 'JUAN PEREZ',
      cantidad: '20',
      capacidad_galones: '10',
      exceso_galones: '10',
      tipo_alerta: 'sobrecapacidad',
      estado: 'pendiente',
      creado_en: '2026-09-01 09:00:00',
      reporte_ruta: '/uploads/reportes_alertas/x.pdf',
      reporte_nombre: 'x.pdf',
      reporte_tipo: 'application/pdf'
    },
    {
      id: 2,
      registro_id: 1,
      fecha: '2026-09-01',
      maquina: 'Cierre de día',
      cantidad: '0',
      capacidad_galones: '0',
      exceso_galones: '0',
      tipo_alerta: 'inspeccion_pendiente',
      estado: 'pendiente',
      creado_en: '2026-09-01 18:00:00'
    },
    {
      id: 3,
      registro_id: 999,
      fecha: '2026-09-01',
      maquina: 'MA65',
      cantidad: '5',
      capacidad_galones: '0',
      exceso_galones: '1',
      tipo_alerta: 'promedio',
      estado: 'justificada',
      creado_en: '2026-09-01 19:00:00'
    },
    {
      id: 4,
      registro_id: 2,
      fecha: '2026-09-01',
      maquina: 'MA65',
      cantidad: '20',
      capacidad_galones: '10',
      exceso_galones: '10',
      tipo_alerta: 'sobrecapacidad',
      estado: 'pendiente',
      creado_en: '2026-09-01 09:05:00'
    }
  ],
  notificaciones: [
    {
      id: 1,
      alerta_id: 1,
      rol: 'supervisor',
      titulo: 't',
      mensaje: 'm',
      leida: 0,
      creado_en: '2026-09-01 09:00:00'
    },
    {
      id: 2,
      alerta_id: 4,
      rol: 'supervisor',
      titulo: 't',
      mensaje: 'm',
      leida: 1,
      creado_en: '2026-09-01 09:05:00',
      leida_en: '2026-09-01 10:00:00'
    }
  ],
  auditoria: [
    {
      id: 1,
      usuario_id: 1,
      usuario: 'admin',
      rol: 'super_administrador',
      accion: 'LOGIN',
      modulo: 'usuarios',
      registro_id: null,
      detalle: '{"resultado":"ok"}',
      creado_en: '2026-09-01 07:00:00'
    },
    {
      id: 2,
      usuario_id: 500,
      usuario: 'ex-usuario',
      rol: 'operario',
      accion: 'CREAR',
      modulo: 'registros',
      registro_id: 2,
      detalle: { maquina: 'MA65' },
      creado_en: '2026-09-01 08:00:00'
    }
  ]
};

test('transformar: separa cierres de suministros y reasigna lo que apuntaba a los cierres', () => {
  const { tablas, resumen } = transformar(origen);

  // Jornadas: D1 (el cierre duplicado más reciente gana) y D3 (histórico). El anulado no cuenta.
  assert.deepEqual(tablas.jornadas.map((j) => j.fecha).sort(), ['2026-09-01', '2026-09-03']);
  const d1 = tablas.jornadas.find((j) => j.fecha === '2026-09-01');
  assert.equal(d1.m1_final, 135);
  assert.equal(d1.total_galones, 45);
  assert.equal(d1.estado, 'cerrada');
  assert.equal(resumen.cierresDuplicadosDescartados, 1);
  assert.equal(resumen.cierresAnulados, 1);
  // El checklist del día 3 viene del suministro que lo llenó.
  const d3 = tablas.jornadas.find((j) => j.fecha === '2026-09-03');
  assert.equal(d3.fuga_biodiesel, 'SI');
  assert.equal(d3.sistema_electrico, 'Mal');

  // Suministros: ni los cierres ni el que no tiene fecha; el anulado sí se conserva.
  assert.deepEqual(
    tablas.registros.map((r) => r.id).sort((a, b) => a - b),
    [2, 3, 6, 9]
  );
  assert.equal(tablas.registros.find((r) => r.id === 9).estado, 'ANULADO');
  assert.equal(tablas.registros[0].m1_inicial, undefined); // Los suministros ya no llevan M1/M2
  assert.match(resumen.advertencias.join(' '), /sin fecha/);

  // Alertas: la de inspección (apuntaba a la fila de cierre 1) pasa a la jornada; la huérfana pierde el registro; la repetida se descarta.
  assert.equal(tablas.alertas.length, 3);
  const insp = tablas.alertas.find((a) => a.id === 2);
  assert.equal(insp.registro_id, null);
  assert.equal(insp.jornada_id, d1.id);
  assert.equal(tablas.alertas.find((a) => a.id === 3).registro_id, null);
  assert.equal(tablas.alertas.find((a) => a.id === 1).registro_id, 2);
  // La notificación de la alerta descartada tampoco pasa.
  assert.deepEqual(
    tablas.notificaciones.map((n) => n.id),
    [1]
  );

  // Usuarios: la contraseña en texto plano se cifra; el permiso del usuario inexistente se descarta.
  assert.equal(verifyPassword('texto-plano-8', tablas.usuarios[1].contrasena), true);
  assert.equal(tablas.permisos.length, 1);
  assert.equal(tablas.usuarios[1].debe_cambiar_contrasena, true);

  // Auditoría: el usuario inexistente queda sin referencia pero conserva su nombre; el JSON se normaliza.
  assert.equal(tablas.auditoria[1].usuario_id, null);
  assert.equal(tablas.auditoria[1].usuario, 'ex-usuario');
  assert.deepEqual(JSON.parse(tablas.auditoria[0].detalle), { resultado: 'ok' });

  // Totales de control.
  assert.equal(resumen.totalSuministradoOrigen, 20 + 15.5 + 4); // Sin cierres, sin anulados y sin el suministro sin fecha
});

test('escribir: se carga en el esquema nuevo, la verificación coincide y los id continúan', async (t) => {
  const db = crearBaseDeDatos();
  t.after(() => db.close());
  await aplicarEsquema(db);
  const { tablas, resumen } = transformar(origen);

  await escribir(db, tablas);
  const problemas = await verificar(db, tablas, resumen);
  assert.deepEqual(problemas, []);

  // Los id se conservaron y las secuencias siguen después del mayor.
  const [nuevo] = await db.query(
    "INSERT INTO registros_combustible(fecha,maquina,cantidad) VALUES('2026-09-10','MA65',1) RETURNING id"
  );
  assert.equal(nuevo[0].id, 10);
  const [alerta] = await db.query(
    'SELECT jornada_id,registro_id FROM alertas_combustible WHERE id=2'
  );
  assert.notEqual(alerta[0].jornada_id, null);
  assert.equal(alerta[0].registro_id, null);
  // La auditoría migrada sigue siendo inmutable.
  await assert.rejects(db.query('DELETE FROM auditoria_combustible'), /inmutable/);
});

test('escribir es atómico: si algo falla no queda nada a medias', async (t) => {
  const db = crearBaseDeDatos();
  t.after(() => db.close());
  await aplicarEsquema(db);
  const { tablas } = transformar(origen);
  tablas.notificaciones.push({ ...tablas.notificaciones[0], id: 50, alerta_id: 12345 }); // Referencia rota a propósito
  await assert.rejects(escribir(db, tablas));
  const [f] = await db.query('SELECT COUNT(*)::int AS n FROM usuarios_combustible');
  assert.equal(f[0].n, 0);
});

test('adjuntos antiguos: los que existen se suben y cambian de ruta; los que no, se avisan', async () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.mkdirSync(path.join(carpeta, 'uploads/reportes_alertas'), { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'uploads/reportes_alertas/x.pdf'), '%PDF-1.4');
  const subidos = [];
  const almacenamiento = {
    guardar: async (buf, meta) => (
      subidos.push({ buf: String(buf), ...meta }),
      'sb:alertas/nuevo.pdf'
    )
  };
  const { tablas } = transformar(origen);
  tablas.alertas.push({
    ...tablas.alertas[0],
    id: 99,
    registro_id: null,
    reporte_ruta: '/uploads/reportes_alertas/no-existe.pdf'
  });
  const r = await subirAdjuntosViejos(tablas, almacenamiento, carpeta);
  assert.equal(r.subidos, 1);
  assert.deepEqual(r.faltantes, ['/uploads/reportes_alertas/no-existe.pdf']);
  assert.equal(tablas.alertas.find((a) => a.id === 1).reporte_ruta, 'sb:alertas/nuevo.pdf');
  assert.equal(subidos[0].tipo, 'application/pdf');
  fs.rmSync(carpeta, { recursive: true, force: true });
});
