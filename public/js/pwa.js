// ============================================================================
// pwa.js — APP INSTALABLE, AVISOS DE CIERRE Y NOTIFICACIONES PUSH
// ----------------------------------------------------------------------------
// Se carga en TODAS las pantallas. Hace cuatro cosas:
//   1. Registra el service worker (public/sw.js): la app abre sin internet.
//   2. Muestra una barra de avisos arriba de la pantalla:
//        * "La jornada del dd/mm sigue sin cerrar" (a quien puede registrar).
//        * "Activa las notificaciones" (una vez, si el equipo las permite).
//        * "Instala la app" (si el navegador lo permite).
//   3. Suscribe este equipo a las notificaciones push del servidor.
//   4. Al cerrar sesión, quita la suscripción de este equipo para que los
//      avisos del usuario anterior no lleguen a quien use el equipo después.
// PARA CAMBIAR CADA CUÁNTO SE REVISAN LAS JORNADAS PENDIENTES -> REVISION_MS.
// ============================================================================

(function () {
  'use strict';

  const REVISION_MS = 5 * 60 * 1000; // Revisa jornadas pendientes cada 5 minutos
  const enLogin = /^\/(login)?$/.test(location.pathname);

  // ---------------------------------------------------------------- utilidades
  function sesion() {
    try {
      return JSON.parse(sessionStorage.getItem('sesionCombustible')) || null;
    } catch (_) {
      return null;
    }
  }
  const puedeRegistrar = (s) =>
    Boolean(s && (s.rol === 'super_administrador' || (s.permisos || []).includes('registro')));
  const dd_mm = (f) => String(f).slice(0, 10).split('-').reverse().slice(0, 2).join('/');
  const esIos =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalada =
    window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const guardar = (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch (_) {
      /* almacenamiento bloqueado */
    }
  };
  const leer = (k) => {
    try {
      return localStorage.getItem(k);
    } catch (_) {
      return null;
    }
  };

  function claveABytes(base64url) {
    const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
    const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  }

  // ---------------------------------------------------------------- barra de avisos
  let barra = null;
  function asegurarBarra() {
    if (barra && barra.isConnected) return barra;
    barra = document.createElement('div');
    barra.className = 'barra-avisos';
    barra.setAttribute('role', 'region');
    barra.setAttribute('aria-label', 'Avisos de la aplicación');
    (document.querySelector('main') || document.body).prepend(barra);
    return barra;
  }
  // Un aviso por "id": si ya existe se reemplaza; con texto vacío se quita.
  function aviso(id, { tipo = 'info', texto, acciones = [] } = {}) {
    const existente = document.querySelector(`.barra-aviso[data-id="${id}"]`);
    if (!texto) {
      existente?.remove();
      return;
    }
    const el = existente || document.createElement('div');
    el.className = `barra-aviso ${tipo}`;
    el.dataset.id = id;
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = texto;
    el.append(span);
    acciones.forEach(({ etiqueta, href, alClick, secundario }) => {
      const nodo = href ? document.createElement('a') : document.createElement('button');
      if (href) nodo.href = href;
      else nodo.type = 'button';
      if (secundario) nodo.className = 'secundario';
      nodo.textContent = etiqueta;
      if (alClick) nodo.addEventListener('click', alClick);
      el.append(nodo);
    });
    if (!existente) asegurarBarra().append(el);
  }

  // ---------------------------------------------------------------- service worker
  let registro = null;
  async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      return registro;
    } catch (error) {
      console.warn('No se pudo registrar el service worker.', error);
      return null;
    }
  }

  // ---------------------------------------------------------------- instalar la app
  let promptInstalacion = null;
  window.addEventListener('beforeinstallprompt', (evento) => {
    evento.preventDefault(); // Lo mostramos nosotros, en la barra de avisos
    promptInstalacion = evento;
    if (enLogin || !sesion() || leer('instalarDescartado') === '1') return;
    aviso('instalar', {
      texto: 'Instala la app en este equipo para abrirla más rápido y recibir avisos.',
      acciones: [
        {
          etiqueta: 'Instalar',
          alClick: async () => {
            promptInstalacion.prompt();
            await promptInstalacion.userChoice.catch(() => {});
            promptInstalacion = null;
            aviso('instalar', {});
          }
        },
        {
          etiqueta: 'Ahora no',
          secundario: true,
          alClick: () => {
            guardar('instalarDescartado', '1');
            aviso('instalar', {});
          }
        }
      ]
    });
  });
  window.addEventListener('appinstalled', () => aviso('instalar', {}));

  // ---------------------------------------------------------------- notificaciones push
  const pushSoportado = () =>
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  async function suscribirEsteEquipo() {
    const reg = registro || (await navigator.serviceWorker.ready);
    const info = await (await fetch('/api/push/clave')).json();
    if (!info.activo || !info.clave) return false; // El servidor no tiene notificaciones configuradas
    let suscripcion = await reg.pushManager.getSubscription();
    if (!suscripcion)
      suscripcion = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveABytes(info.clave)
      });
    const respuesta = await fetch('/api/push/suscribir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suscripcion: suscripcion.toJSON() })
    });
    return respuesta.ok;
  }

  // Al cerrar sesión (auth.js lo llama): este equipo deja de recibir los avisos de ese usuario.
  window.desactivarPushEnEsteEquipo = async function () {
    try {
      if (!pushSoportado()) return;
      const reg = registro || (await navigator.serviceWorker.getRegistration());
      const suscripcion = await reg?.pushManager.getSubscription();
      if (!suscripcion) return;
      await fetch('/api/push/desuscribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: suscripcion.endpoint })
      });
      await suscripcion.unsubscribe();
    } catch (_) {
      /* no debe impedir el cierre de sesión */
    }
  };

  async function gestionarNotificaciones() {
    const s = sesion();
    if (!s || enLogin) return;

    // iPhone/iPad: las notificaciones solo funcionan con la app instalada en la pantalla de inicio.
    if (esIos && !instalada) {
      if (leer('avisoIosDescartado') !== '1')
        aviso('ios', {
          texto:
            'Para recibir avisos en iPhone/iPad: toca Compartir y luego "Añadir a pantalla de inicio".',
          acciones: [
            {
              etiqueta: 'Entendido',
              secundario: true,
              alClick: () => {
                guardar('avisoIosDescartado', '1');
                aviso('ios', {});
              }
            }
          ]
        });
      return;
    }
    if (!pushSoportado()) return;

    if (Notification.permission === 'granted') {
      // Ya autorizado: se asegura (una vez por sesión) que este equipo esté registrado con el usuario actual.
      if (sessionStorage.getItem('pushSincronizado') === '1') return;
      try {
        if (await suscribirEsteEquipo()) sessionStorage.setItem('pushSincronizado', '1');
      } catch (error) {
        console.warn('No se pudo registrar el equipo para notificaciones.', error);
      }
      return;
    }
    if (Notification.permission === 'denied' || leer('pushDescartado') === '1') return;

    // Solo se ofrece si el servidor las tiene configuradas.
    try {
      const info = await (await fetch('/api/push/clave')).json();
      if (!info.activo) return;
    } catch (_) {
      return;
    }
    aviso('push', {
      texto: 'Activa las notificaciones para avisarte si falta cerrar la jornada.',
      acciones: [
        {
          etiqueta: 'Activar avisos',
          alClick: async () => {
            const permiso = await Notification.requestPermission(); // Requiere un toque del usuario
            aviso('push', {});
            if (permiso === 'granted') {
              try {
                await suscribirEsteEquipo();
                sessionStorage.setItem('pushSincronizado', '1');
                if (window.Swal)
                  Swal.fire({
                    icon: 'success',
                    title: 'Avisos activados',
                    text: 'Te notificaremos si una jornada queda sin cerrar.',
                    timer: 2500,
                    showConfirmButton: false
                  });
              } catch (error) {
                console.warn(error);
              }
            }
          }
        },
        {
          etiqueta: 'Ahora no',
          secundario: true,
          alClick: () => {
            guardar('pushDescartado', '1');
            aviso('push', {});
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------------- jornadas pendientes
  async function revisarJornadasPendientes() {
    const s = sesion();
    if (!s || !puedeRegistrar(s) || enLogin) return;
    try {
      const respuesta = await fetch('/api/jornadas/pendientes', { cache: 'no-store' });
      if (!respuesta.ok) return;
      const { pendientes } = await respuesta.json();
      if (!pendientes.length) return aviso('jornada', {});
      const masAntigua = pendientes[0];
      aviso('jornada', {
        tipo: 'alerta',
        texto:
          pendientes.length === 1
            ? `⚠ La jornada del ${dd_mm(masAntigua.fecha)} sigue sin cerrar. Ingresa las lecturas finales de M1/M2 y guarda el cierre.`
            : `⚠ Hay ${pendientes.length} jornadas sin cerrar (desde el ${dd_mm(masAntigua.fecha)}).`,
        acciones: [
          {
            etiqueta: 'Ir a cerrarla',
            href: `/index?fecha=${encodeURIComponent(masAntigua.fecha)}`
          }
        ]
      });
    } catch (_) {
      /* sin conexión: se vuelve a intentar en la próxima revisión */
    }
  }

  // ---------------------------------------------------------------- arranque
  registrarServiceWorker().then(() => {
    gestionarNotificaciones();
  });
  revisarJornadasPendientes();
  setInterval(revisarJornadasPendientes, REVISION_MS);
  window.addEventListener('online', revisarJornadasPendientes);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarJornadasPendientes();
  });
})();
