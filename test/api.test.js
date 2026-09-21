// ============================================================================
// api.test.js — PRUEBAS DE INTEGRACIÓN (npm test)
// ----------------------------------------------------------------------------
// Levantan la aplicación REAL con un PostgreSQL embebido (PGlite) y recorren
// los flujos completos por HTTP. No necesitan internet ni cuenta de Supabase.
// ============================================================================

process.env.DB_DRIVER = 'pglite';
process.env.NODE_ENV = 'test';
process.env.CRON_SECRET = 'secreto-de-pruebas-1234567890';
process.env.HORA_LIMITE_CIERRE = '00:00'; // Para que "hoy" cuente como tarde en las pruebas del cron
process.env.VAPID_PUBLIC_KEY = 'clave-publica-de-prueba';
process.env.VAPID_PRIVATE_KEY = 'clave-privada-de-prueba';
delete process.env.SUPABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');
const { aplicarEsquema } = require('../scripts/db-migrar');
const { hashPassword } = require('../src/shared/infrastructure/security');
const { hoyLocal, sumarDias } = require('../src/shared/application/fechas');

const db = app.locals.db;
let servidor;
let base;
const hoy = hoyLocal();
const ayer = sumarDias(hoy, -1);
const enviadosPush = [];

// Cliente HTTP mínimo con cookie de sesión.
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
    datos = texto;
  }
  return { estado: respuesta.status, datos, cabeceras: respuesta.headers };
}

async function iniciarSesion(usuario, contrasena = 'clave-1234') {
  const r = await api('POST', '/api/login', { usuario, contrasena });
  assert.equal(r.estado, 200, `login de ${usuario}: ${JSON.stringify(r.datos)}`);
  return String(r.cabeceras.get('set-cookie')).split(';')[0];
}

async function crearUsuario(usuario, rol, vistas) {
  const [f] = await db.query(
    'INSERT INTO usuarios_combustible(usuario,contrasena,rol) VALUES(?,?,?) RETURNING id',
    [usuario, hashPassword('clave-1234'), rol]
  );
  for (const v of vistas)
    await db.query('INSERT INTO permisos_usuarios_combustible(usuario_id,vista) VALUES(?,?)', [
      f[0].id,
      v
    ]);
  return f[0].id;
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
  await aplicarEsquema(db);
  await crearUsuario('admin', 'super_administrador', []);
  await crearUsuario('sup', 'supervisor', [
    'registro',
    'tablas',
    'reportes',
    'alertas',
    'auditoria',
    'tractores'
  ]);
  await crearUsuario('op', 'operario', ['registro']);
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
  // Push simulado: no sale nada a internet, solo se anota lo que se enviaría.
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

test.after(async () => {
  servidor.close();
  await db.close();
});

// ---------------------------------------------------------------- seguridad
test('sin sesión la API responde 401 y el login incorrecto también', async () => {
  assert.equal((await api('GET', '/api/registros')).estado, 401);
  assert.equal(
    (await api('POST', '/api/login', { usuario: 'op', contrasena: 'mala' })).estado,
    401
  );
});

test('el límite de intentos de login bloquea al noveno intento', async () => {
  let ultimo;
  for (let i = 0; i < 9; i++)
    ultimo = await api('POST', '/api/login', { usuario: 'fantasma', contrasena: 'x' });
  assert.equal(ultimo.estado, 429);
});

test('un operario no puede entrar a módulos sin permiso', async () => {
  assert.equal((await api('GET', '/api/reportes', undefined, op)).estado, 403);
  assert.equal((await api('GET', '/api/auditoria', undefined, op)).estado, 403);
});

// ---------------------------------------------------------------- catálogos
test('catálogos: crear máquina y operario, y anular con motivo', async () => {
  let r = await api(
    'POST',
    '/api/tractores',
    { maquina: 'ma65', descripcion: 'tractor', centro_costo: '1', capacidad_galones: 29.1 },
    admin
  );
  assert.equal(r.estado, 201);
  assert.equal(r.datos.maquina, 'MA65');
  r = await api('POST', '/api/operarios', { nombre: 'juan perez', cedula: '1001' }, admin);
  assert.equal(r.estado, 201);
  const idOperario = r.datos.id;
  r = await api('POST', '/api/operarios', { nombre: 'otro', cedula: '2' }, admin);
  const anular = await api('DELETE', `/api/operarios/${r.datos.id}`, { motivo: 'prueba' }, admin);
  assert.equal(anular.estado, 200);
  const lista = await api('GET', '/api/operarios', undefined, admin);
  assert.ok(lista.datos.some((o) => o.id === idOperario));
  assert.ok(!lista.datos.some((o) => o.nombre === 'OTRO'));
  assert.equal((await api('GET', '/api/tractores/abc', undefined, admin)).estado === 200, false);
});

// ------------------------------------------------ jornada: autoguardado y recuperación
test('jornada: lo que el operario escribe se conserva si sale y vuelve a entrar', async () => {
  let r = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, op);
  assert.equal(r.estado, 200);
  assert.equal(r.datos.jornada, null);
  assert.equal(r.datos.hayCierreDia, false);

  // El operario escribe la lectura inicial de M1 y el checklist; se autoguarda.
  r = await api(
    'PUT',
    `/api/jornadas/${hoy}`,
    { m1Inicial: '1000', m2Inicial: '2000', fugaBiodiesel: 'NO' },
    op
  );
  assert.equal(r.estado, 200);
  assert.equal(r.datos.jornada.estado, 'abierta');

  // "Sale de la app": vuelve a entrar con una sesión nueva y todo sigue ahí.
  const opNueva = await iniciarSesion('op');
  r = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, opNueva);
  assert.equal(Number(r.datos.jornada.m1Inicial), 1000);
  assert.equal(Number(r.datos.jornada.m2Inicial), 2000);
  assert.equal(r.datos.jornada.fugaBiodiesel, 'NO');
  assert.equal(r.datos.jornada.estado, 'abierta');
  assert.equal(r.datos.hayCierreDia, false);

  // Otro operario que entra más tarde ve lo mismo (una sola jornada por día).
  r = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, sup);
  assert.equal(r.datos.jornada.abiertaPor, 'op');

  // Un valor inválido se rechaza sin tocar lo guardado.
  r = await api('PUT', `/api/jornadas/${hoy}`, { m1Final: 'abc' }, op);
  assert.equal(r.estado, 400);
});

test('el operario no puede guardar borradores de fechas pasadas ni futuras', async () => {
  assert.equal(
    (await api('PUT', `/api/jornadas/${sumarDias(hoy, -3)}`, { m1Inicial: '5' }, op)).estado,
    403
  );
  assert.equal(
    (await api('PUT', `/api/jornadas/${sumarDias(hoy, 1)}`, { m1Inicial: '5' }, admin)).estado,
    400
  );
});

// ------------------------------------------------ suministros
test('suministro: se guarda sin duplicar la jornada y genera alerta de sobrecapacidad', async () => {
  let r = await api('POST', '/api/registros', suministro({ cantidad: '40' }), op);
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.alertaSobrecapacidad, true);

  const [j] = await db.query('SELECT COUNT(*)::int AS n FROM jornadas_combustible WHERE fecha=?', [
    hoy
  ]);
  assert.equal(j[0].n, 1);

  const alertas = await api('GET', '/api/alertas', undefined, sup);
  assert.ok(alertas.datos.some((a) => a.tipo_alerta === 'sobrecapacidad' && a.maquina === 'MA65'));

  // Los suministros ya no llevan datos de M1/M2 ni marcan cierre.
  const lista = await api('GET', '/api/registros', undefined, op);
  assert.equal(lista.datos.length, 1);
  assert.equal(lista.datos[0].cierreDia, false);
  assert.equal(lista.datos[0].m1Inicial, undefined);
});

test('suministro: validaciones (firma, horómetro que retrocede, fecha pasada del operario)', async () => {
  assert.equal((await api('POST', '/api/registros', suministro({ firma: '' }), op)).estado, 400);
  const r = await api('POST', '/api/registros', suministro({ horometro: '50' }), op);
  assert.equal(r.estado, 400);
  assert.match(r.datos.mensaje, /horometro/i);
  assert.equal((await api('POST', '/api/registros', suministro({ fecha: ayer }), op)).estado, 403);
});

test('suministro: sin ninguna lectura inicial disponible no se puede iniciar', async () => {
  const r = await api(
    'POST',
    '/api/registros',
    suministro({ fecha: sumarDias(hoy, -2), m1Inicial: '', m2Inicial: '' }),
    admin
  );
  assert.equal(r.estado, 400);
  // La transacción se deshizo: no quedó jornada ni registro de ese día.
  const [j] = await db.query('SELECT COUNT(*)::int AS n FROM jornadas_combustible WHERE fecha=?', [
    sumarDias(hoy, -2)
  ]);
  assert.equal(j[0].n, 0);
});

// ------------------------------------------------ cierre
test('cierre: un solo cierre por día, con galones calculados por el servidor', async () => {
  let r = await api(
    'POST',
    '/api/cierre-dia',
    { fecha: hoy, m1Final: '1030.5', m2Final: '2010', galonesM1: '999' },
    op
  );
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.equal(r.datos.estado, 'cerrada');
  assert.equal(Number(r.datos.galonesM1), 30.5); // ignora el 999 que mandó el navegador
  assert.equal(Number(r.datos.totalGalones), 40.5);

  // Segundo cierre del mismo día: rechazado para el operario.
  r = await api('POST', '/api/cierre-dia', { fecha: hoy, m1Final: '1040' }, op);
  assert.equal(r.estado, 409);
  // Borrador sobre jornada cerrada: rechazado.
  assert.equal((await api('PUT', `/api/jornadas/${hoy}`, { m1Final: '1' }, op)).estado, 409);
  // El super administrador sí puede corregir.
  r = await api('POST', '/api/cierre-dia', { fecha: hoy, m1Final: '1031' }, admin);
  assert.equal(r.estado, 201);
  assert.equal(Number(r.datos.galonesM1), 31);

  const estado = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, op);
  assert.equal(estado.datos.hayCierreDia, true);
  assert.equal(Number(estado.datos.cierreActual.m1_final), 1031);

  // Un suministro tardío después del cierre no toca las lecturas cerradas.
  r = await api(
    'POST',
    '/api/registros',
    suministro({ m1Inicial: '5', cantidad: '5', horometro: '110' }),
    op
  );
  assert.equal(r.estado, 201);
  const [j] = await db.query('SELECT m1_inicial FROM jornadas_combustible WHERE fecha=?', [hoy]);
  assert.equal(Number(j[0].m1_inicial), 1000);
});

test('cierre: las lecturas finales no pueden ser menores que las iniciales', async () => {
  await db.query('DELETE FROM jornadas_combustible WHERE fecha=?', [ayer]);
  await api('PUT', `/api/jornadas/${ayer}`, { m1Inicial: '500' }, admin);
  const r = await api('POST', '/api/cierre-dia', { fecha: ayer, m1Final: '400' }, admin);
  assert.equal(r.estado, 400);
});

test('push inmediato: la alerta avisa a supervisores y administradores con permiso, no al operario', async () => {
  const supSinAlertas = await crearUsuario('sup2', 'supervisor', ['registro']); // No puede ver Alertas
  assert.ok(supSinAlertas);
  const cookieSup2 = await iniciarSesion('sup2');
  const dispositivos = [
    [sup, 'https://push.example/sup'],
    [admin, 'https://push.example/adm'],
    [op, 'https://push.example/operario'],
    [cookieSup2, 'https://push.example/sup-sin-alertas']
  ];
  for (const [cookie, endpoint] of dispositivos) {
    const r = await api(
      'POST',
      '/api/push/suscribir',
      { suscripcion: { endpoint, keys: { p256dh: 'p', auth: 'a' } } },
      cookie
    );
    assert.equal(r.estado, 201);
  }
  const avisosDeAlertas = () => enviadosPush.filter((p) => p.mensaje.url === '/alertas');

  // 1) Horómetro "dañado" (texto en vez de número) -> alerta de horómetro irregular
  enviadosPush.length = 0;
  let r = await api(
    'POST',
    '/api/registros',
    suministro({ horometro: 'DAÑADO', cantidad: '5' }),
    op
  );
  assert.equal(r.estado, 201, JSON.stringify(r.datos));
  assert.deepEqual(
    avisosDeAlertas()
      .map((a) => a.endpoint)
      .sort(),
    ['https://push.example/adm', 'https://push.example/sup']
  );
  assert.match(avisosDeAlertas()[0].mensaje.titulo, /Horómetro irregular: MA65/);
  assert.match(avisosDeAlertas()[0].mensaje.cuerpo, /DAÑADO/);

  // 2) Se supera la capacidad del tanque -> alerta de sobrecapacidad
  enviadosPush.length = 0;
  r = await api('POST', '/api/registros', suministro({ horometro: '300', cantidad: '45' }), op);
  assert.equal(r.estado, 201);
  const sobre = avisosDeAlertas();
  assert.equal(sobre.length, 2);
  assert.match(sobre[0].mensaje.titulo, /Sobrecapacidad: MA65/);
  assert.match(sobre[0].mensaje.cuerpo, /45\.00 gal/);

  // 3) Un registro normal NO avisa a nadie
  enviadosPush.length = 0;
  r = await api('POST', '/api/registros', suministro({ horometro: '310', cantidad: '5' }), op);
  assert.equal(r.estado, 201);
  assert.equal(avisosDeAlertas().length, 0);

  // 4) Si falla el envío del aviso, el registro se guarda igual
  const original = app.locals.pushService.webpush.sendNotification;
  app.locals.pushService.webpush.sendNotification = async () => {
    throw Object.assign(new Error('caído'), { statusCode: 500 });
  };
  r = await api('POST', '/api/registros', suministro({ horometro: '320', cantidad: '46' }), op);
  app.locals.pushService.webpush.sendNotification = original;
  assert.equal(r.estado, 201);

  await db.query('DELETE FROM suscripciones_push'); // Limpieza para las pruebas siguientes
});

test('continuidad: la lectura inicial de hoy es la final del cierre de ayer', async () => {
  const manana = sumarDias(hoy, 0);
  // Se cierra "ayer" (500 -> 600) y se comprueba contra la fecha de hoy.
  let r = await api('POST', '/api/cierre-dia', { fecha: ayer, m1Final: '600' }, admin);
  assert.equal(r.estado, 201);
  await db.query('DELETE FROM alertas_combustible WHERE jornada_id IS NOT NULL');
  await db.query('UPDATE jornadas_combustible SET estado=?,m1_inicial=NULL WHERE fecha=?', [
    'abierta',
    manana
  ]);
  r = await api('PUT', `/api/jornadas/${hoy}`, { m1Inicial: '777' }, admin);
  assert.equal(Number(r.datos.jornada.m1Inicial), 600); // se corrige solo
  const estado = await api('GET', `/api/cierre-dia/estado?fecha=${hoy}`, undefined, op);
  assert.equal(Number(estado.datos.m1Anterior), 600);
  assert.equal(estado.datos.hayCierreDiaAnterior, true);
});

// ------------------------------------------------ pendientes y recordatorios
test('pendientes y cron: jornada sin cerrar genera aviso, alerta única y push', async () => {
  const antier = sumarDias(hoy, -2);
  await api('PUT', `/api/jornadas/${antier}`, { m1Inicial: '10', m2Inicial: '20' }, admin);

  // Un dispositivo suscrito (el del operario).
  let r = await api(
    'POST',
    '/api/push/suscribir',
    { suscripcion: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } } },
    op
  );
  assert.equal(r.estado, 201);

  r = await api('GET', '/api/jornadas/pendientes', undefined, op);
  assert.ok(r.datos.pendientes.some((p) => p.fecha === antier && p.motivo === 'vencida'));

  // El cron exige el secreto.
  assert.equal((await api('GET', '/api/tareas/recordatorio-cierre')).estado, 401);
  const conSecreto = async () => {
    const x = await fetch(base + '/api/tareas/recordatorio-cierre', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` }
    });
    return { estado: x.status, datos: await x.json() };
  };
  r = await conSecreto();
  assert.equal(r.estado, 200);
  assert.ok(r.datos.pendientes >= 1);
  assert.ok(r.datos.alertasNuevas >= 1);
  assert.ok(
    enviadosPush.some(
      (p) => p.endpoint === 'https://push.example/abc' && /jornada/i.test(p.mensaje.titulo)
    )
  );

  // Segunda ejecución: NO duplica la alerta.
  const r2 = await conSecreto();
  assert.equal(r2.datos.alertasNuevas, 0);
  const alertas = await api('GET', '/api/alertas', undefined, sup);
  assert.equal(
    alertas.datos.filter((a) => a.tipo_alerta === 'cierre_pendiente' && a.fecha === antier).length,
    1
  );

  // Al cerrar la jornada, la alerta se resuelve sola y ya no está pendiente.
  await api('POST', '/api/cierre-dia', { fecha: antier, m1Final: '15' }, admin);
  const despues = await api('GET', '/api/alertas', undefined, sup);
  const alerta = despues.datos.find(
    (a) => a.tipo_alerta === 'cierre_pendiente' && a.fecha === antier
  );
  assert.equal(alerta.estado, 'justificada');
  const pend = await api('GET', '/api/jornadas/pendientes', undefined, op);
  assert.ok(!pend.datos.pendientes.some((p) => p.fecha === antier));
});

test('cerrar sin checklist genera la alerta de inspección pendiente', async () => {
  const dia = sumarDias(hoy, -3);
  await api('PUT', `/api/jornadas/${dia}`, { m1Inicial: '1' }, admin);
  await api('POST', '/api/cierre-dia', { fecha: dia, m1Final: '2' }, admin);
  const alertas = await api('GET', '/api/alertas', undefined, sup);
  assert.ok(alertas.datos.some((a) => a.tipo_alerta === 'inspeccion_pendiente' && a.fecha === dia));
});

test('push: dispositivo caducado (410) se elimina y sin claves no se envía', async () => {
  const servicio = app.locals.pushService;
  const original = servicio.webpush.sendNotification;
  servicio.webpush.sendNotification = async () => {
    throw Object.assign(new Error('gone'), { statusCode: 410 });
  };
  const r = await servicio.notificar({ vista: 'registro' }, { titulo: 'x', cuerpo: 'y' });
  servicio.webpush.sendNotification = original;
  assert.equal(r.enviados, 0);
  const [f] = await db.query('SELECT COUNT(*)::int AS n FROM suscripciones_push');
  assert.equal(f[0].n, 0);
});

// ------------------------------------------------ reportes
test('reportes: suministros y jornadas independientes, con conciliación', async () => {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const lista = await api('GET', '/api/reportes', undefined, sup);
  assert.equal(lista.estado, 200);
  const actual = lista.datos.find((m) => m.anio === anio && m.mes === mes);
  assert.ok(actual);
  assert.equal(actual.estado, 'abierto');
  assert.ok(actual.totalRegistros >= 2);
  assert.ok(actual.totalGalones > 0);
  assert.equal(typeof actual.diferencia, 'number');

  const detalle = await api('GET', `/api/reportes/${anio}/${mes}/registros`, undefined, sup);
  assert.equal(detalle.estado, 200);
  assert.ok(Array.isArray(detalle.datos.suministros) && detalle.datos.suministros.length >= 2);
  assert.ok(Array.isArray(detalle.datos.jornadas) && detalle.datos.jornadas.length >= 1);
  assert.equal(detalle.datos.jornadas[0].cierreDia, true);
  assert.equal(
    detalle.datos.conciliacion.diferencia,
    Math.round(
      (detalle.datos.conciliacion.totalSurtidor - detalle.datos.conciliacion.totalSuministrado) *
        100
    ) / 100
  );

  const general = await api(
    'GET',
    `/api/reportes-general/registros?fechaInicio=${anio}-01-01&fechaFin=${anio}-12-31&busqueda=ma65`,
    undefined,
    sup
  );
  assert.ok(general.datos.suministros.every((r) => r.maquina === 'MA65'));
  assert.equal((await api('GET', '/api/reportes/2026/13/registros', undefined, sup)).estado, 400);
});

// ------------------------------------------------ auditoría inmutable
test('auditoría: solo lectura por la API y protegida por la base de datos', async () => {
  const lista = await api('GET', '/api/auditoria', undefined, admin);
  assert.equal(lista.estado, 200);
  assert.ok(lista.datos.registros.length > 0);
  const id = lista.datos.registros[0].id;
  assert.equal((await api('PUT', `/api/auditoria/${id}`, { motivo: 'x' }, admin)).estado, 404);
  assert.equal((await api('DELETE', `/api/auditoria/${id}`, undefined, admin)).estado, 404);
  await assert.rejects(db.query('DELETE FROM auditoria_combustible'), /inmutable/);
  await assert.rejects(db.query("UPDATE auditoria_combustible SET accion='X'"), /inmutable/);

  const csv = await api('GET', '/api/auditoria/export', undefined, admin);
  assert.equal(csv.estado, 200);
  assert.match(String(csv.datos), /"id","usuario"/);
  const filtrada = await api(
    'GET',
    `/api/auditoria?fechaDesde=${hoy}&fechaHasta=${hoy}&q=cierre`,
    undefined,
    admin
  );
  assert.equal(filtrada.estado, 200);
});

test('eliminar un usuario conserva su auditoría', async () => {
  const id = await crearUsuario('temporal', 'operario', ['registro']);
  const cookie = await iniciarSesion('temporal');
  await api('POST', '/api/logout', {}, cookie);
  const antes = (
    await db.query("SELECT COUNT(*)::int AS n FROM auditoria_combustible WHERE usuario='temporal'")
  )[0][0].n;
  assert.ok(antes >= 1);
  await api('DELETE', `/api/usuarios/${id}`, undefined, admin);
  const despues = (
    await db.query("SELECT COUNT(*)::int AS n FROM auditoria_combustible WHERE usuario='temporal'")
  )[0][0].n;
  assert.equal(despues, antes);
});

// ------------------------------------------------ errores de base de datos
test('un id inválido responde 400/404 y no 500', async () => {
  const r = await api('GET', '/api/alertas/abc/soporte', undefined, sup);
  assert.ok([400, 404].includes(r.estado), `estado ${r.estado}`);
  assert.equal((await api('PUT', '/api/registros/abc', { cantidad: 1 }, admin)).estado, 404);
});
