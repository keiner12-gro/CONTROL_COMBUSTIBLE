(function () {
  'use strict';

  const pagina = window.location.pathname.split('/').pop() || 'menu';
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  if (!sesion) return;

  // Estructura agrupada de navegacion. "grupo:null" es el item suelto (Inicio).
  const grupos = [
    { grupo: null, items: [{ href: 'menu', vista: null, icon: '⌂', label: 'Inicio' }] },
    {
      grupo: 'Operación',
      items: [
        { href: 'index', vista: 'registro', icon: '⛽', label: 'Registrar suministro' },
        { href: 'tablas', vista: 'tablas', icon: '📋', label: 'Historial' }
      ]
    },
    {
      grupo: 'Flota',
      items: [
        { href: 'tractores', vista: 'tractores', icon: '🚜', label: 'Máquinas' },
        { href: 'operarios', vista: 'operarios', icon: '👤', label: 'Operarios' }
      ]
    },
    { grupo: 'Análisis', items: [{ href: 'reportes', vista: 'reportes', icon: '📊', label: 'Reportes' }] },
    {
      grupo: 'Monitoreo',
      items: [
        { href: 'alertas', vista: 'alertas', icon: '🔔', label: 'Alertas', badge: true },
        { href: 'auditoria', vista: 'auditoria', icon: '🧾', label: 'Auditoría' }
      ]
    },
    {
      grupo: 'Administración',
      items: [{ href: 'usuarios', vista: 'usuarios', icon: '👥', label: 'Usuarios y permisos' }]
    }
  ];

  // Los 4 accesos mas usados, para la barra inferior en movil.
  const itemsBarraInferior = ['menu', 'index', 'tablas', 'alertas'];

  const tienePermiso = (vista) => {
    if (!vista) return true;
    if (typeof usuarioTienePermiso === 'function') return usuarioTienePermiso(vista);
    const rol = String(sesion.rol || '').toLowerCase();
    const permisos = Array.isArray(sesion.permisos) ? sesion.permisos.map((p) => String(p).toLowerCase()) : [];
    return rol === 'super_administrador' || permisos.includes(vista);
  };

  const inicialesUsuario = (nombre) =>
    String(nombre || '?')
      .trim()
      .split(/\s+|\./)
      .filter(Boolean)
      .slice(0, 2)
      .map((parte) => parte[0].toUpperCase())
      .join('') || '?';

  const logoSrc = '../assets/WhatsApp Image 2026-08-11 at 6.40.45 AM.jpeg';

  function itemEsVisible(item) {
    return tienePermiso(item.vista);
  }

  // ---------- Rail persistente (escritorio/tablet) ----------
  function construirRail() {
    const rail = document.createElement('aside');
    rail.className = 'rail';

    let html = `
      <div class="rail-brand">
        <div class="logo-mini"><img src="${logoSrc}" alt="Logo Guaicaramo SAS"></div>
        <div><strong>GUAICARAMO</strong><span>Combustible</span></div>
      </div>
    `;

    grupos.forEach((grupo) => {
      const visibles = grupo.items.filter(itemEsVisible);
      if (!visibles.length) return;
      if (grupo.grupo) html += `<div class="rail-group-label">${grupo.grupo}</div>`;
      visibles.forEach((item) => {
        const activo = pagina === item.href;
        html += `
          <a class="rail-item${activo ? ' activo' : ''}" href="${item.href}" data-vista="${item.vista || 'menu'}"${activo ? ' aria-current="page"' : ''}>
            <span class="rail-icon">${item.icon}</span>
            <span class="rail-label">${item.label}</span>
            ${item.badge ? '<span class="rail-badge" id="rail-badge-alertas" hidden></span>' : ''}
          </a>
        `;
      });
    });

    html += `
      <div class="rail-foot">
        <div class="rail-user">
          <div class="rail-avatar">${inicialesUsuario(sesion.usuario)}</div>
          <div><strong>${escapeHtml ? escapeHtml(sesion.usuario || '') : sesion.usuario || ''}</strong><span>${escapeHtml ? escapeHtml(sesion.rol || '') : sesion.rol || ''}</span></div>
        </div>
        <button class="rail-logout" type="button" id="rail-boton-cerrar-sesion">
          <span class="rail-icon">↪</span><span class="texto">Cerrar sesión</span>
        </button>
      </div>
    `;

    rail.innerHTML = html;
    return rail;
  }

  // ---------- Cajon movil (reutiliza el mismo look que ya existia) ----------
  function construirDrawer() {
    const sidebar = document.createElement('aside');
    sidebar.className = 'menu-lateral';
    sidebar.id = 'menu-lateral';
    sidebar.setAttribute('aria-hidden', 'true');

    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';
    overlay.id = 'menu-overlay';
    overlay.hidden = true;

    sidebar.innerHTML = `
      <div class="menu-lateral-cabecera">
        <div class="menu-lateral-marca">
          <div class="menu-lateral-logo"><img src="${logoSrc}" alt="Logo Guaicaramo SAS"></div>
          <div><strong>GUAICARAMO SAS</strong><span>Control de Combustible</span></div>
        </div>
        <button class="menu-cerrar" type="button" aria-label="Cerrar menú">×</button>
      </div>
      <div class="menu-separador"></div>
      <nav class="menu-navegacion" aria-label="Menú principal"></nav>
      <div class="menu-lateral-pie">
        <button class="menu-cerrar-sesion" type="button"><span>↪</span> CERRAR SESIÓN</button>
      </div>
    `;

    const nav = sidebar.querySelector('.menu-navegacion');
    grupos.forEach((grupo) => {
      const visibles = grupo.items.filter(itemEsVisible);
      if (!visibles.length) return;
      if (grupo.grupo) {
        const etiqueta = document.createElement('p');
        etiqueta.className = 'menu-seccion';
        etiqueta.textContent = grupo.grupo.toUpperCase();
        nav.appendChild(etiqueta);
      }
      visibles.forEach((item) => {
        const enlace = document.createElement('a');
        enlace.href = item.href;
        enlace.className = 'menu-item-lateral';
        enlace.dataset.vista = item.vista || 'menu';
        enlace.innerHTML = `<span class="menu-item-icon">${item.icon}</span><span class="menu-item-text">${item.label}</span>${item.badge ? '<span class="menu-alerta-badge" id="drawer-badge-alertas" hidden></span>' : ''}`;
        if (pagina === item.href) {
          enlace.classList.add('activo');
          enlace.setAttribute('aria-current', 'page');
        }
        nav.appendChild(enlace);
      });
    });

    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);
    return { sidebar, overlay };
  }

  // ---------- Barra inferior (movil) ----------
  function construirBarraInferior() {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Navegación rápida');

    const todos = grupos.flatMap((g) => g.items).filter(itemEsVisible);
    const principales = itemsBarraInferior
      .map((href) => todos.find((item) => item.href === href))
      .filter(Boolean);

    let html = '';
    principales.forEach((item) => {
      const activo = pagina === item.href;
      html += `
        <a href="${item.href}" data-vista="${item.vista || 'menu'}" class="${activo ? 'activo' : ''}">
          <span>${item.icon}</span><small>${item.label.split(' ')[0]}</small>
          ${item.badge ? '<span class="bn-badge" id="bn-badge-alertas" hidden></span>' : ''}
        </a>
      `;
    });
    html += `<button type="button" id="boton-mas-nav"><span>☰</span><small>Más</small></button>`;

    nav.innerHTML = html;
    return nav;
  }

  // ---------- Montaje: envuelve .pantalla junto con el rail ----------
  const pantalla = document.querySelector('main.pantalla') || document.body.querySelector('.pantalla');
  if (!pantalla) return;

  document.body.classList.add('con-shell');

  const layout = document.createElement('div');
  layout.className = 'shell-layout';
  pantalla.parentNode.insertBefore(layout, pantalla);

  const rail = construirRail();
  layout.appendChild(rail);
  layout.appendChild(pantalla);

  const { sidebar: drawer, overlay } = construirDrawer();
  const barraInferior = construirBarraInferior();
  document.body.appendChild(barraInferior);

  // ---------- Interacciones ----------
  const cerrarDrawer = () => {
    drawer.classList.remove('abierto');
    overlay.classList.remove('visible');
    overlay.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-lateral-abierto');
  };
  const abrirDrawer = () => {
    drawer.classList.add('abierto');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('menu-lateral-abierto');
  };

  const botonHamburguesa = document.querySelector('.boton-tres-puntos');
  if (botonHamburguesa) {
    botonHamburguesa.addEventListener('click', () => {
      drawer.classList.contains('abierto') ? cerrarDrawer() : abrirDrawer();
    });
  }
  document.getElementById('boton-mas-nav')?.addEventListener('click', abrirDrawer);
  drawer.querySelector('.menu-cerrar').addEventListener('click', cerrarDrawer);
  overlay.addEventListener('click', cerrarDrawer);
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarDrawer();
  });

  const cerrarSesionClick = () => {
    if (typeof cerrarSesion === 'function') cerrarSesion();
  };
  document.getElementById('rail-boton-cerrar-sesion')?.addEventListener('click', cerrarSesionClick);
  drawer.querySelector('.menu-cerrar-sesion').addEventListener('click', cerrarSesionClick);

  // ---------- Fecha en el encabezado ----------
  const fecha = document.querySelector('[data-fecha-encabezado]');
  if (fecha) {
    const actualizarFecha = () => {
      const ahora = new Date();
      fecha.textContent =
        ahora.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ', ' +
        ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
    };
    actualizarFecha();
    setInterval(actualizarFecha, 30000);
  }

  // ---------- Indicador de alertas pendientes ----------
  const badges = [
    document.getElementById('rail-badge-alertas'),
    document.getElementById('drawer-badge-alertas'),
    document.getElementById('bn-badge-alertas')
  ].filter(Boolean);

  if (badges.length && typeof usuarioTienePermiso === 'function' && usuarioTienePermiso('alertas')) {
    const revisarBadge = async () => {
      try {
        const respuesta = await fetch('/api/notificaciones', { cache: 'no-store' });
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        const pendientes = datos.filter((n) => Number(n.leida) === 0);
        const texto = pendientes.length > 9 ? '9+' : String(pendientes.length);
        badges.forEach((badge) => {
          badge.hidden = pendientes.length === 0;
          if (pendientes.length) badge.textContent = texto;
        });
      } catch (_) {}
    };
    revisarBadge();
    setInterval(revisarBadge, 10000);
  }
})();
