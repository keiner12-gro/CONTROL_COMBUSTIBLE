// ============================================================================
// sw.js — SERVICE WORKER (app instalable + notificaciones push)
// ----------------------------------------------------------------------------
// Hace tres cosas:
//   1. Guarda una copia de las pantallas y archivos de la app en el equipo para
//      que ABRA SIN INTERNET (los datos de la API nunca se guardan aquí).
//   2. Recibe las notificaciones push ("Falta cerrar la jornada") aunque la app
//      esté cerrada, y las muestra.
//   3. Al tocar la notificación, abre la pantalla que corresponde.
// PARA FORZAR QUE TODOS LOS EQUIPOS DESCARGUEN LA VERSIÓN NUEVA de la app:
// cambia VERSION (cada despliegue importante). Si agregas un archivo a
// public/js o public/css, agrégalo también a PRECACHE (una prueba automática
// avisa si falta).
// ============================================================================

const VERSION = 'v1-2026-09-18';
const CACHE = `combustible-${VERSION}`;

const PAGINAS = [
  '/login',
  '/menu',
  '/index',
  '/tablas',
  '/usuarios',
  '/tractores',
  '/operarios',
  '/reportes',
  '/reporte-detalle',
  '/alertas',
  '/auditoria',
  '/cambiar-contrasena'
];
const PRECACHE = [
  ...PAGINAS,
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/WhatsApp Image 2026-08-11 at 6.40.45 AM.jpeg',
  '/css/styles.css',
  '/css/theme.css',
  '/vendor/sweetalert2.all.min.js',
  '/vendor/chart.umd.js',
  '/js/alertas.js',
  '/js/app.js',
  '/js/auditoria.js',
  '/js/auth.js',
  '/js/cambiar-contrasena.js',
  '/js/jornada-borrador.js',
  '/js/login.js',
  '/js/menu.js',
  '/js/operarios.js',
  '/js/pwa.js',
  '/js/reporte-detalle.js',
  '/js/reportes.js',
  '/js/shell.js',
  '/js/sidebar.js',
  '/js/tablas.js',
  '/js/tractores.js',
  '/js/usuarios.js'
];

// --- Instalación: se guardan las pantallas y archivos base ------------------
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // allSettled: si un archivo falla, los demás igual se guardan.
      await Promise.allSettled(
        PRECACHE.map(async (ruta) => {
          const respuesta = await fetch(ruta, { cache: 'reload' });
          if (respuesta.ok && !respuesta.redirected) await cache.put(ruta, respuesta);
        })
      );
      await self.skipWaiting(); // La versión nueva se activa sin esperar
    })()
  );
});

// --- Activación: se borran las copias de versiones anteriores ---------------
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith('combustible-') && n !== CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// --- Respuestas: red primero, copia guardada si no hay internet -------------
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return; // Los envíos (POST/PUT) siempre van al servidor
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return; // Nada de otros dominios
  if (url.pathname.startsWith('/api/')) return; // Los DATOS nunca se guardan: siempre del servidor
  if (url.pathname === '/sw.js') return;

  // Pantallas: se intenta la red; sin internet, la copia; si no hay, la página "sin conexión".
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      (async () => {
        try {
          const respuesta = await fetch(peticion);
          if (respuesta.ok && !respuesta.redirected) {
            const cache = await caches.open(CACHE);
            cache.put(url.origin + url.pathname, respuesta.clone()); // Sin ?parámetros: una copia por pantalla
          }
          return respuesta;
        } catch (_) {
          return (
            (await caches.match(url.origin + url.pathname)) ||
            (await caches.match('/offline.html')) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Íconos, imágenes y librerías casi nunca cambian: primero la copia.
  if (/^\/(vendor|icons|assets)\//.test(url.pathname)) {
    evento.respondWith(
      (async () => {
        const guardada = await caches.match(peticion, { ignoreSearch: true });
        if (guardada) return guardada;
        const respuesta = await fetch(peticion);
        if (respuesta.ok) (await caches.open(CACHE)).put(peticion, respuesta.clone());
        return respuesta;
      })()
    );
    return;
  }

  // Scripts y estilos de la app: red primero (para recibir las actualizaciones), copia si no hay internet.
  evento.respondWith(
    (async () => {
      try {
        const respuesta = await fetch(peticion);
        if (respuesta.ok)
          (await caches.open(CACHE)).put(url.origin + url.pathname, respuesta.clone());
        return respuesta;
      } catch (_) {
        return (await caches.match(url.origin + url.pathname)) || Response.error();
      }
    })()
  );
});

// --- Notificaciones push ----------------------------------------------------
self.addEventListener('push', (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch (_) {
    datos = { titulo: 'Control de Combustible', cuerpo: evento.data ? evento.data.text() : '' };
  }
  const titulo = datos.titulo || 'Control de Combustible';
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: datos.etiqueta || 'combustible', // Un aviso nuevo reemplaza al anterior del mismo tipo
      renotify: true,
      data: { url: datos.url || '/menu' }
    })
  );
});

// Al tocar el aviso: si la app está abierta se enfoca esa ventana; si no, se abre.
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(
    (evento.notification.data && evento.notification.data.url) || '/menu',
    self.location.origin
  ).href;
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const ventana of ventanas) {
        if ('focus' in ventana) {
          await ventana.focus();
          if ('navigate' in ventana) await ventana.navigate(destino).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(destino);
    })()
  );
});

// La clave pública VAPID viene en base64url; el navegador la necesita como bytes.
function claveABytes(base64url) {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

// Si el navegador renueva la suscripción push, se registra la nueva en el servidor.
self.addEventListener('pushsubscriptionchange', (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        const clave = await (await fetch('/api/push/clave')).json();
        if (!clave.activo || !clave.clave) return;
        const suscripcion = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: claveABytes(clave.clave)
        });
        await fetch('/api/push/suscribir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suscripcion: suscripcion.toJSON() })
        });
      } catch (_) {
        /* Se reintentará la próxima vez que el usuario abra la app */
      }
    })()
  );
});
