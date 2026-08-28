(function () {
  'use strict';

  const pagina = window.location.pathname.split('/').pop() || 'menu.html';
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  if (!sesion) return;

  const items = [
    { href: 'menu.html', vista: null, icon: '⌂', label: 'MENU' },
    { href: 'index.html', vista: 'registro', icon: '⛽', label: 'registros de suministros' },
    { href: 'tablas.html', vista: 'tablas', icon: '&#128203;', label: 'tablas' },
    { href: 'tractores.html', vista: 'tractores', icon: '🚜', label: 'Máquinas' },
    { href: 'operarios.html', vista: 'operarios', icon: '&#128100;', label: 'Operarios' },
    { href: 'reportes.html', vista: 'reportes', icon: '&#128202;', label: 'Reportes' },
    { href: 'alertas.html', vista: 'alertas', icon: '⚠', label: 'Alertas', badge: true },
    { href: 'usuarios.html', vista: 'usuarios', icon: '&#128101;', label: 'Usuarios' }
  ];

  const tienePermiso = (vista) => {
    if (!vista) return true;
    if (typeof usuarioTienePermiso === 'function') return usuarioTienePermiso(vista);
    const rol = String(sesion.rol || '').toLowerCase();
    const permisos = Array.isArray(sesion.permisos) ? sesion.permisos.map(p => String(p).toLowerCase()) : [];
    return rol === 'super_administrador' || permisos.includes(vista);
  };

  const sidebar = document.createElement('aside');
  sidebar.className = 'menu-lateral';
  sidebar.id = 'menu-lateral';
  sidebar.setAttribute('aria-hidden', 'true');

  const overlay = document.createElement('div');
  overlay.className = 'menu-overlay';
  overlay.id = 'menu-overlay';
  overlay.hidden = true;

  const logoSrc = '../assets/WhatsApp Image 2026-08-11 at 6.40.45 AM.jpeg';
  sidebar.innerHTML = `
    <div class="menu-lateral-cabecera">
      <div class="menu-lateral-marca">
        <div class="menu-lateral-logo"><img src="${logoSrc}" alt="Logo Guaicaramo SAS"></div>
        <div>
          <strong>GUAICARAMO SAS</strong>
          <span>Control de Combustible</span>
        </div>
      </div>
      <button class="menu-cerrar" type="button" aria-label="Cerrar menú">×</button>
    </div>
    <div class="menu-separador"></div>
    <p class="menu-seccion">MENÚ PRINCIPAL</p>
    <nav class="menu-navegacion" aria-label="Menú principal"></nav>
    <div class="menu-lateral-pie">
      <button class="menu-cerrar-sesion" type="button"><span>↪</span> CERRAR SESIÓN</button>
    </div>
  `;

  const nav = sidebar.querySelector('.menu-navegacion');
  items.forEach(item => {
    if (!tienePermiso(item.vista)) return;
    const enlace = document.createElement('a');
    enlace.href = item.href;
    enlace.className = 'menu-item-lateral';
    enlace.dataset.vista = item.vista || 'menu';
    enlace.innerHTML = `<span class="menu-item-icon">${item.icon}</span><span class="menu-item-text">${item.label}</span>${item.badge ? '<span class="menu-alerta-badge" hidden></span>' : ''}`;
    if (pagina === item.href) {
      enlace.classList.add('activo');
      enlace.setAttribute('aria-current', 'page');
    }
    nav.appendChild(enlace);
  });

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);

  const botonMenu = document.querySelector('.boton-tres-puntos');
  const cerrar = () => {
    sidebar.classList.remove('abierto');
    overlay.classList.remove('visible');
    overlay.hidden = true;
    sidebar.setAttribute('aria-hidden', 'true');
    if (botonMenu) botonMenu.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-lateral-abierto');
  };
  const abrir = () => {
    sidebar.classList.add('abierto');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
    sidebar.setAttribute('aria-hidden', 'false');
    if (botonMenu) botonMenu.setAttribute('aria-expanded', 'true');
    document.body.classList.add('menu-lateral-abierto');
  };

  if (botonMenu) botonMenu.addEventListener('click', () => {
    sidebar.classList.contains('abierto') ? cerrar() : abrir();
  });
  sidebar.querySelector('.menu-cerrar').addEventListener('click', cerrar);
  overlay.addEventListener('click', cerrar);
  sidebar.querySelector('.menu-cerrar-sesion').addEventListener('click', () => {
    if (typeof cerrarSesion === 'function') cerrarSesion();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cerrar();
  });

  const titulo = document.querySelector('.encabezado h1');
  if (titulo && pagina === 'menu.html') titulo.textContent = 'MENU';

  const fecha = document.querySelector('[data-fecha-encabezado]');
  if (fecha) {
    const actualizarFecha = () => {
      const ahora = new Date();
      fecha.textContent = ahora.toLocaleDateString('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric'
      }) + ', ' + ahora.toLocaleTimeString('es-CO', {
        hour: '2-digit', minute: '2-digit', hour12: true
      });
    };
    actualizarFecha();
    setInterval(actualizarFecha, 30000);
  }

  // Indicador visual de alertas pendientes. No genera notificaciones por sí mismo.
  const badge = sidebar.querySelector('.menu-alerta-badge');
  if (badge && usuarioTienePermiso('alertas')) {
    const revisarBadge = async () => {
      try {
        const respuesta = await fetch('/api/notificaciones', {
          cache: 'no-store'
        });
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        const pendientes = datos.filter(n => Number(n.leida) === 0);
        badge.hidden = pendientes.length === 0;
        if (pendientes.length) badge.textContent = pendientes.length > 9 ? '9+' : String(pendientes.length);
      } catch (_) {}
    };
    revisarBadge();
    setInterval(revisarBadge, 10000);
  }
})();
