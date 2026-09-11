// ============================================================================
// shell.js — ARMAZÓN DE NAVEGACIÓN (menú lateral, cajón móvil y barra inferior)
// ----------------------------------------------------------------------------
// Se carga en todas las pantallas internas y CONSTRUYE EL MENÚ POR CÓDIGO: los
// HTML no traen el menú escrito, lo genera este archivo.
// Produce tres navegaciones a partir de la misma lista:
//   1. "rail"  -> barra lateral fija (escritorio).
//   2. "drawer"-> cajón deslizante (móvil, se abre con el botón ☰).
//   3. "bottom-nav" -> barra inferior con 4 accesos rápidos (móvil).
// PARA AGREGAR, QUITAR O RENOMBRAR UNA OPCIÓN DEL MENÚ -> arreglo "grupos".
// ============================================================================

// IIFE: función que se ejecuta sola y encierra todo su código, para no dejar
// variables sueltas que choquen con los otros scripts de la página.
(function () {
  'use strict'; // Modo estricto: errores más claros y menos comportamientos raros

  const pagina = window.location.pathname.split('/').pop() || 'menu'; // Página actual
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  if (!sesion) return; // Sin sesión no se dibuja menú alguno

  // Estructura agrupada de navegacion. "grupo:null" es el item suelto (Inicio).
  // Cada item: href (destino), vista (permiso requerido), icon, label y
  // badge (si lleva el contador rojo de pendientes).
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

  // ¿Se muestra esta opción? Usa la función de auth.js y, si no estuviera
  // disponible, hace su propia comprobación de respaldo.
  const tienePermiso = (vista) => {
    if (!vista) return true; // Opciones sin permiso asociado (Inicio)
    if (typeof usuarioTienePermiso === 'function') return usuarioTienePermiso(vista);
    const rol = String(sesion.rol || '').toLowerCase();
    const permisos = Array.isArray(sesion.permisos) ? sesion.permisos.map((p) => String(p).toLowerCase()) : [];
    return rol === 'super_administrador' || permisos.includes(vista);
  };

  // Iniciales para el avatar circular: "juan.perez" -> "JP".
  const inicialesUsuario = (nombre) =>
    String(nombre || '?')
      .trim()
      .split(/\s+|\./) // Separa por espacios o puntos
      .filter(Boolean)
      .slice(0, 2) // Máximo dos iniciales
      .map((parte) => parte[0].toUpperCase())
      .join('') || '?';

  const logoSrc = '../assets/WhatsApp Image 2026-08-11 at 6.40.45 AM.jpeg';

  function itemEsVisible(item) {
    return tienePermiso(item.vista);
  }

  // ---------- Rail persistente (escritorio/tablet) ----------
  // Barra lateral siempre visible con logo, grupos de opciones y pie de usuario.
  function construirRail() {
    const rail = document.createElement('aside');
    rail.className = 'rail';

    // Cabecera con el logo de la empresa.
    let html = `
      <div class="rail-brand">
        <div class="logo-mini"><img src="${logoSrc}" alt="Logo Guaicaramo SAS"></div>
        <div><strong>GUAICARAMO</strong><span>Combustible</span></div>
      </div>
    `;

    // Se recorre cada grupo; si ninguna de sus opciones es visible, el grupo
    // entero (incluido su título) se omite.
    grupos.forEach((grupo) => {
      const visibles = grupo.items.filter(itemEsVisible);
      if (!visibles.length) return;
      if (grupo.grupo) html += `<div class="rail-group-label">${grupo.grupo}</div>`;
      visibles.forEach((item) => {
        const activo = pagina === item.href; // Resalta la página en la que se está
        html += `
          <a class="rail-item${activo ? ' activo' : ''}" href="${item.href}" data-vista="${item.vista || 'menu'}"${activo ? ' aria-current="page"' : ''}>
            <span class="rail-icon">${item.icon}</span>
            <span class="rail-label">${item.label}</span>
            ${item.badge ? '<span class="rail-badge" id="rail-badge-alertas" hidden></span>' : ''}
          </a>
        `;
      });
    });

    // Pie: avatar con iniciales, nombre, rol y botón de cerrar sesión.
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
  // Panel que se desliza desde un lado más la capa oscura de fondo (overlay).
  function construirDrawer() {
    const sidebar = document.createElement('aside');
    sidebar.className = 'menu-lateral';
    sidebar.id = 'menu-lateral';
    sidebar.setAttribute('aria-hidden', 'true'); // Oculto para lectores de pantalla mientras esté cerrado

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

    // Las opciones se crean con createElement (no con innerHTML) porque así se
    // insertan de forma segura los textos.
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
  // Solo los 4 accesos de itemsBarraInferior más un botón "Más" que abre el cajón.
  function construirBarraInferior() {
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Navegación rápida');

    // flatMap aplana todos los grupos en una sola lista de opciones visibles.
    const todos = grupos.flatMap((g) => g.items).filter(itemEsVisible);
    // Se respeta el orden definido en itemsBarraInferior y se descarta lo que
    // el usuario no tenga permitido (filter(Boolean) quita los undefined).
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
  // Se busca el contenedor principal de la página y se envuelve junto al rail
  // dentro de un "shell-layout" (CSS grid de dos columnas).
  const pantalla = document.querySelector('main.pantalla') || document.body.querySelector('.pantalla');
  if (!pantalla) return; // Página sin contenedor: no se monta el armazón

  document.body.classList.add('con-shell'); // Activa los estilos del armazón

  const layout = document.createElement('div');
  layout.className = 'shell-layout';
  pantalla.parentNode.insertBefore(layout, pantalla); // Se inserta el envoltorio

  const rail = construirRail();
  layout.appendChild(rail); // Columna 1: menú lateral
  layout.appendChild(pantalla); // Columna 2: contenido de la página (se mueve aquí)

  const { sidebar: drawer, overlay } = construirDrawer();
  const barraInferior = construirBarraInferior();
  document.body.appendChild(barraInferior);

  // ---------- Interacciones ----------
  // Abrir/cerrar el cajón móvil manteniendo sincronizados clases, overlay y
  // atributos de accesibilidad.
  const cerrarDrawer = () => {
    drawer.classList.remove('abierto');
    overlay.classList.remove('visible');
    overlay.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('menu-lateral-abierto'); // Devuelve el scroll al fondo
  };
  const abrirDrawer = () => {
    drawer.classList.add('abierto');
    overlay.hidden = false;
    // requestAnimationFrame: se muestra primero el elemento y en el siguiente
    // cuadro se activa la clase, para que la transición de opacidad se vea.
    requestAnimationFrame(() => overlay.classList.add('visible'));
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('menu-lateral-abierto');
  };

  // Formas de abrir el cajón: el botón ☰ del encabezado y el botón "Más".
  const botonHamburguesa = document.querySelector('.boton-tres-puntos');
  if (botonHamburguesa) {
    botonHamburguesa.addEventListener('click', () => {
      drawer.classList.contains('abierto') ? cerrarDrawer() : abrirDrawer();
    });
  }
  document.getElementById('boton-mas-nav')?.addEventListener('click', abrirDrawer);
  // Formas de cerrarlo: la ×, tocar el fondo oscuro o la tecla Escape.
  drawer.querySelector('.menu-cerrar').addEventListener('click', cerrarDrawer);
  overlay.addEventListener('click', cerrarDrawer);
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrarDrawer();
  });

  // Cerrar sesión: mismo comportamiento desde el rail y desde el cajón.
  const cerrarSesionClick = () => {
    if (typeof cerrarSesion === 'function') cerrarSesion(); // Definida en auth.js
  };
  document.getElementById('rail-boton-cerrar-sesion')?.addEventListener('click', cerrarSesionClick);
  drawer.querySelector('.menu-cerrar-sesion').addEventListener('click', cerrarSesionClick);

  // ---------- Fecha en el encabezado ----------
  // Rellena cualquier elemento con data-fecha-encabezado y la refresca cada 30 s.
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
  // El mismo contador rojo aparece en las tres navegaciones a la vez.
  const badges = [
    document.getElementById('rail-badge-alertas'),
    document.getElementById('drawer-badge-alertas'),
    document.getElementById('bn-badge-alertas')
  ].filter(Boolean); // Solo los que existan en esta pantalla

  if (badges.length && typeof usuarioTienePermiso === 'function' && usuarioTienePermiso('alertas')) {
    const revisarBadge = async () => {
      try {
        const respuesta = await fetch('/api/notificaciones', { cache: 'no-store' });
        if (!respuesta.ok) return;
        const datos = await respuesta.json();
        const pendientes = datos.filter((n) => Number(n.leida) === 0);
        const texto = pendientes.length > 9 ? '9+' : String(pendientes.length); // Tope visual "9+"
        badges.forEach((badge) => {
          badge.hidden = pendientes.length === 0; // Sin pendientes, se oculta
          if (pendientes.length) badge.textContent = texto;
        });
      } catch (_) {} // Un fallo de red no debe romper la navegación
    };
    revisarBadge();
    setInterval(revisarBadge, 10000); // Se refresca cada 10 segundos
  }
})();
