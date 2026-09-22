// ============================================================================
// airtable-app.test.js — LA APP COMPLETA CORRIENDO CON DB_PROVIDER=airtable
// ----------------------------------------------------------------------------
// Levanta server.js de verdad (Express real, todas las rutas reales) contra el
// Airtable falso: es la prueba más fuerte de que el interruptor DB_PROVIDER
// funciona de punta a punta, sin necesitar una cuenta real de Airtable.
// Compárese con test/api.test.js, que hace lo mismo contra Postgres/PGlite.
// ============================================================================

process.env.DB_PROVIDER = 'airtable';
process.env.AIRTABLE_API_KEY = 'clave-falsa';
process.env.NODE_ENV = 'test';
process.env.CRON_SECRET = 'secreto-de-pruebas-1234567890';
process.env.HORA_LIMITE_CIERRE = '00:00';
process.env.VAPID_PUBLIC_KEY = 'clave-publica-de-prueba';
process.env.VAPID_PRIVATE_KEY = 'clave-privada-de-prueba';
delete process.env.SUPABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAirtableFalso } = require('./helpers/fake-airtable');
const { hashPassword } = require('../src/shared/infrastructure/security');
const { hoyLocal, sumarDias } = require('../src/shared/application/fechas');

const servidor = crearAirtableFalso();
process.env.AIRTABLE_BASE_ID = servidor.baseId;

// El cliente de Airtable que construye server.js toma globalThis.fetch como
// valor por defecto EN EL MOMENTO en que se crea (al hacer require más abajo);
// después de eso ya no hace falta mantener el reemplazo.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = servidor.fetch;
const app = require('../server');
globalThis.fetch = fetchOriginal;

let servidorHttp;
let base;
const hoy = hoyLocal();
const ayer = sumarDias(hoy, -1);
const enviadosPush = [];

async function api(metodo, ruta, cuerpo, cookie) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await respuesta.text();
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch (_) {
    datos = texto; // Respuestas que no son JSON (p. ej. el CSV de auditoría)
  }
  return { estado: respuesta.status, datos, cabeceras: respuesta.headers };
}

async function iniciarSesion(usuario, contrasena = 'clave-1234') {
  const r = await api('POST', '/api/login', { usuario, contrasena });
  assert.equal(r.estado, 200, `login de ${usuario}: ${JSON.stringify(r.datos)}`);
  return String(r.cabeceras.get('set-cookie')).split(';')[0];
}

function crearUsuario(usuario, rol, vistas) {
  const [id] = servidor.sembrar('usuarios_combustible', [
    { usuario, contrasena: hashPassword('clave-1234'), rol }
  ]);
  servidor.sembrar(
    'permisos_usuarios_combustible',
    vistas.map((vista) => ({ usuario_id: id, vista }))
  );
  return id;
}

const suministro = (extra = {}) => ({
  fecha: hoy,
  m1Inicial: '1000',
  m2Inicial: '2000',
  fugaBiodiesel: 'NO',
  sistemaElectrico: 'BUEN ESTADO',
  paradaEmergencia: 'BUEN ESTADO',
  operario: 'juan perez',
  cedula: '1001',
  maquina: 'ma65',
  horometro: '100',
  cantidad: '10',
  numeroSai: 'sai-1',
  firma: 'data:image/png;base64,AAAA',
  observaciones: '',
  ...extra
});

let admin, sup, op;

test.before(async () => {
  crearUsuario('admin', 'super_administrador', []);
  crearUsuario('sup', 'supervisor', [
    'registro',
    'tablas',
    'reportes',
    'alertas',
    'auditoria',
    'tractores'
  ]);
  crearUsuario('op', 'operario', ['registro']);
  servidor.sembrar('tractores', [
    {
      item: 1,
      maquina: 'MA65',
      descripcion: 'TRACTOR',
      centro_costo: '1',
      capacidad_galones: 29.1,
      estado: 'ACTIVO'
    }
  ]);
  servidorHttp = app.listen(0);
  base = `http://127.0.0.1:${servidorHttp.address().port}`;
  app.locals.pushService.webpush = {
    setVapidDetails() {},
    async sendNotification(suscripcion, mensaje) {
      enviadosPush.push({ endpoint: suscripcion.endpoint, mensaje: JSON.parse(mensaje) });
    }
  };
  admin = await iniciarSesion('admin');
  sup = await iniciarSesion('sup');
  op = await iniciarSesion('op');
});

test.after(() => servidorHttp.close());

test('la app arrancó con el proveedor Airtable', () => {
  assert.equal(app.locals.provider, 'airtable');
  assert.ok(app.locals.airtableClient);
});

test('login funciona y protege las rutas por rol/permiso', async () => {
  assert.equal((await api('GET', '/api/registros')).estado, 401);
  assert.equal(
    (await api('POST', '/api/login', { usuario: 'admin', contrasena: 'mala' })).estado,
    401
  );
  assert.equal((await api('GET', '/api/reportes', undefined, op)).estado, 403); // El operario no ve reportes
});

test('catálogos: crear máquina y operario, y anular con motivo (queda en auditoría)', async () => {
  const r = await api(
    'POST',
    '/api/tractores',
    { maquina: 'ma70', descripcion: 'otro', centro_costo: '2', capacidad_galones: 20 },
    admin
  );
  assert.equal(r.estado, 201);
  const o = await api('POST', '/api/operarios', { nombre: 'juan perez', cedula: '1001' }, admin);
  assert.equal(o.estado, 201);
  const anular = await api('DELETE', `/api/tractores/${r.datos.id}`, { motivo: 'prueba' }, admin);
  assert.equal(anular.estado, 200);
});

test('suministro con sobrecapacidad: se guarda, crea alerta y avisa por push al instante', async () => {
  const dispositivo = await api(
    'POST',
    '/api/push/suscribir',
    { suscripcion: { endpoint: 'https://push.example/admin', keys: { p256dh: 'p', auth: 'a' } } },
    admin
  );
  assert.equal(dispositivo.estado, 201);

  const r = await api('POST', '/api/registros', suministro({ cantidad: '40' }), op);
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.alertaSobrecapacidad, true);

  const alertas = await api('GET', '/api/alertas', undefined, sup);
  assert.ok(alertas.datos.some((a) => a.tipo_alerta === 'sobrecapacidad' && a.maquina === 'MA65'));

  const avisoInmediato = enviadosPush.find((p) => p.mensaje.titulo?.includes('Sobrecapacidad'));
  assert.ok(avisoInmediato, 'debió llegar el aviso push inmediato');
});

test('jornada: se conserva entre peticiones (simula que el operario sale y vuelve)', async () => {
  const est1 = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, op);
  assert.equal(est1.datos.jornada.estado, 'abierta');
  assert.equal(Number(est1.datos.jornada.m1Inicial), 1000);
  const otraSesion = await iniciarSesion('op');
  const est2 = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, otraSesion);
  assert.equal(Number(est2.datos.jornada.m1Inicial), 1000);
});

test('cierre: un solo cierre por día, con galones calculados por el servidor', async () => {
  let r = await api(
    'POST',
    '/api/cierre-dia',
    { fecha: hoy, m1Final: '1030.5', m2Final: '2010' },
    op
  );
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(Number(r.datos.galonesM1), 30.5);

  r = await api('POST', '/api/cierre-dia', { fecha: hoy, m1Final: '1040' }, op);
  assert.equal(r.estado, 409); // Ya está cerrada

  r = await api('POST', '/api/cierre-dia', { fecha: hoy, m1Final: '1031' }, admin);
  assert.equal(r.estado, 201); // El super administrador sí puede corregir
  assert.equal(Number(r.datos.galonesM1), 31);
});

test('reportes: suministros y jornadas por separado, con conciliación', async () => {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const detalle = await api('GET', `/api/reportes/${anio}/${mes}/registros`, undefined, sup);
  assert.equal(detalle.estado, 200);
  assert.ok(detalle.datos.suministros.length >= 1);
  assert.ok(detalle.datos.jornadas.length >= 1);
  assert.equal(typeof detalle.datos.conciliacion.diferencia, 'number');

  const lista = await api('GET', '/api/reportes', undefined, sup);
  const actual = lista.datos.find((m) => m.anio === anio && m.mes === mes);
  assert.ok(actual);
  assert.ok(actual.totalGalones > 0);
});

test('auditoría: quedó registrado el login y el cierre; export en CSV funciona', async () => {
  const lista = await api('GET', `/api/auditoria?accion=LOGIN`, undefined, admin);
  assert.equal(lista.estado, 200);
  assert.ok(lista.datos.registros.length >= 3); // admin, sup, op
  const csv = await api('GET', '/api/auditoria/export', undefined, admin);
  assert.equal(csv.estado, 200);
  assert.match(String(csv.datos), /"id","usuario"/);
});

test('cron: jornada del día anterior sin cerrar genera alerta y push', async () => {
  await api('PUT', `/api/jornadas/${ayer}`, { m1Inicial: '10' }, admin);
  const respuesta = await fetch(base + '/api/tareas/recordatorio-cierre', {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
  });
  assert.equal(respuesta.status, 200);
  const cuerpo = await respuesta.json();
  assert.ok(cuerpo.pendientes >= 1);
  assert.ok(cuerpo.alertasNuevas >= 1);
});
