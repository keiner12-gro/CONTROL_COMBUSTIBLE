// ============================================================================
// sw.test.js — PRUEBAS DEL SERVICE WORKER (public/sw.js)
// ----------------------------------------------------------------------------
// Ejecutan sw.js en un entorno simulado (sin navegador) y comprueban:
//   * que guarda las pantallas al instalarse,
//   * que la API NUNCA se guarda ni se intercepta,
//   * que sin internet abre la copia guardada (o la página "sin conexión"),
//   * que muestra las notificaciones push y abre la pantalla correcta al tocarlas,
//   * que PRECACHE incluye todos los archivos de public/js y public/css.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '../public');
const codigo = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');

// Entorno mínimo que imita el del navegador para un service worker.
function crearEntorno({ enLinea = true } = {}) {
  const almacenes = new Map(); // nombre -> Map(url -> respuesta)
  const oyentes = {};
  const notificaciones = [];
  const ventanasAbiertas = [];
  const peticiones = [];
  let estadoRed = enLinea;

  const respuesta = (cuerpo, estado = 200, extra = {}) => ({
    ok: estado >= 200 && estado < 300,
    status: estado,
    redirected: false,
    body: cuerpo,
    clone() {
      return respuesta(cuerpo, estado, extra);
    },
    ...extra
  });
  const abrirAlmacen = (nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map());
    const a = almacenes.get(nombre);
    return {
      async put(clave, r) {
        a.set(String(typeof clave === 'string' ? clave : clave.url), r);
      },
      async keys() {
        return [...a.keys()];
      }
    };
  };
  const normalizar = (u) =>
    new URL(String(typeof u === 'string' ? u : u.url), 'https://app.test').href;

  const sandbox = {
    self: null,
    URL,
    Response: { error: () => ({ error: true }) },
    console,
    caches: {
      open: async (n) => abrirAlmacen(n),
      keys: async () => [...almacenes.keys()],
      delete: async (n) => almacenes.delete(n),
      match: async (clave) => {
        const k = normalizar(clave);
        for (const a of almacenes.values())
          for (const [u, r] of a) if (normalizar(u) === k) return r;
        return undefined;
      }
    },
    fetch: async (u) => {
      const url = normalizar(typeof u === 'string' ? u : u);
      peticiones.push(url);
      if (!estadoRed) throw new TypeError('sin conexión');
      return respuesta(`contenido de ${url}`);
    },
    atob: (t) => Buffer.from(t, 'base64').toString('binary'),
    Uint8Array
  };
  sandbox.self = {
    location: { origin: 'https://app.test' },
    addEventListener: (nombre, fn) => (oyentes[nombre] = fn),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (u) => ventanasAbiertas.push(u)
    },
    registration: { showNotification: async (t, o) => notificaciones.push({ titulo: t, ...o }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox);

  // Dispara un evento y espera lo que se pasó a waitUntil/respondWith.
  async function disparar(nombre, datos = {}) {
    let promesa;
    const evento = {
      ...datos,
      waitUntil: (p) => (promesa = p),
      respondWith: (p) => (promesa = p)
    };
    oyentes[nombre](evento);
    return promesa === undefined ? undefined : await promesa;
  }
  const peticion = (ruta, extra = {}) => ({
    method: 'GET',
    url: `https://app.test${ruta}`,
    mode: 'no-cors',
    ...extra
  });

  return {
    disparar,
    peticion,
    almacenes,
    notificaciones,
    ventanasAbiertas,
    peticiones,
    ponerRed: (v) => (estadoRed = v)
  };
}

test('al instalarse guarda las pantallas y archivos base', async () => {
  const sw = crearEntorno();
  await sw.disparar('install');
  const [nombre] = sw.almacenes.keys();
  assert.match(nombre, /^combustible-/);
  const guardados = [...sw.almacenes.get(nombre).keys()];
  for (const ruta of [
    '/menu',
    '/index',
    '/offline.html',
    '/js/app.js',
    '/vendor/sweetalert2.all.min.js'
  ])
    assert.ok(guardados.includes(ruta), `falta ${ruta}`);
});

test('la API no se intercepta ni se guarda; los envíos (POST) tampoco', async () => {
  const sw = crearEntorno();
  await sw.disparar('install');
  const antes = sw.peticiones.length;
  assert.equal(await sw.disparar('fetch', { request: sw.peticion('/api/registros') }), undefined);
  assert.equal(
    await sw.disparar('fetch', {
      request: sw.peticion('/index', { method: 'POST', mode: 'navigate' })
    }),
    undefined
  );
  assert.equal(
    await sw.disparar('fetch', { request: { ...sw.peticion('/x'), url: 'https://otro.com/x' } }),
    undefined
  );
  assert.equal(sw.peticiones.length, antes); // No hizo ninguna petición por su cuenta
});

test('sin internet abre la copia guardada de la pantalla, o la página "sin conexión"', async () => {
  const sw = crearEntorno();
  await sw.disparar('install');
  sw.ponerRed(false);
  const menu = await sw.disparar('fetch', {
    request: sw.peticion('/menu?x=1', { mode: 'navigate' })
  });
  assert.match(menu.body, /\/menu/); // La copia de /menu (sin parámetros)
  const desconocida = await sw.disparar('fetch', {
    request: sw.peticion('/no-existe', { mode: 'navigate' })
  });
  assert.match(desconocida.body, /offline\.html/);
});

test('con internet las pantallas vienen del servidor (red primero)', async () => {
  const sw = crearEntorno();
  await sw.disparar('install');
  const r = await sw.disparar('fetch', { request: sw.peticion('/tablas', { mode: 'navigate' }) });
  assert.match(r.body, /contenido de https:\/\/app\.test\/tablas/);
});

test('las versiones anteriores del caché se borran al activarse', async () => {
  const sw = crearEntorno();
  await sw.disparar('install');
  sw.almacenes.set('combustible-viejo', new Map());
  sw.almacenes.set('otra-cosa', new Map());
  await sw.disparar('activate');
  assert.ok(!sw.almacenes.has('combustible-viejo'));
  assert.ok(sw.almacenes.has('otra-cosa')); // No toca cachés ajenos
});

test('push: muestra la notificación con título, texto y destino', async () => {
  const sw = crearEntorno();
  await sw.disparar('push', {
    data: {
      json: () => ({
        titulo: 'Falta cerrar la jornada',
        cuerpo: 'La jornada del 17/09 sigue abierta.',
        url: '/index?fecha=2026-09-17',
        etiqueta: 'cierre-pendiente'
      })
    }
  });
  assert.equal(sw.notificaciones.length, 1);
  const n = sw.notificaciones[0];
  assert.equal(n.titulo, 'Falta cerrar la jornada');
  assert.equal(n.tag, 'cierre-pendiente');
  assert.equal(n.data.url, '/index?fecha=2026-09-17');
  assert.match(n.icon, /icon-192/);
});

test('tocar la notificación abre la pantalla indicada', async () => {
  const sw = crearEntorno();
  let cerrada = false;
  await sw.disparar('notificationclick', {
    notification: { close: () => (cerrada = true), data: { url: '/index?fecha=2026-09-17' } }
  });
  assert.ok(cerrada);
  assert.deepEqual(sw.ventanasAbiertas, ['https://app.test/index?fecha=2026-09-17']);
});

test('PRECACHE incluye todos los archivos de public/js, public/css y las pantallas', () => {
  const ficheros = [
    ...fs.readdirSync(path.join(RAIZ, 'js')).map((f) => `/js/${f}`),
    ...fs.readdirSync(path.join(RAIZ, 'css')).map((f) => `/css/${f}`),
    ...fs.readdirSync(path.join(RAIZ, 'html')).map((f) => `/${f.replace('.html', '')}`)
  ];
  const faltan = ficheros.filter((f) => !codigo.includes(`'${f}'`));
  assert.deepEqual(faltan, [], `Agrega a PRECACHE en public/sw.js: ${faltan.join(', ')}`);
});

test('el manifiesto es válido y sus íconos existen', () => {
  const m = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(
    m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512')
  );
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const icono of m.icons)
    assert.ok(fs.existsSync(path.join(RAIZ, icono.src)), `falta ${icono.src}`);
});

test('todas las pantallas enlazan el manifiesto, pwa.js y ninguna usa un CDN externo', () => {
  for (const f of fs.readdirSync(path.join(RAIZ, 'html'))) {
    const html = fs.readFileSync(path.join(RAIZ, 'html', f), 'utf8');
    assert.match(html, /rel="manifest"/, `${f} sin manifiesto`);
    assert.match(html, /\/js\/pwa\.js/, `${f} sin pwa.js`);
    assert.doesNotMatch(html, /https?:\/\/cdn\./, `${f} usa un CDN externo`);
  }
});
