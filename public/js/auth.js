// ============================================================================
// auth.js — SEGURIDAD Y UTILIDADES COMPARTIDAS DEL FRONTEND
// ----------------------------------------------------------------------------
// Este archivo se carga en TODAS las páginas protegidas (antes que el script
// propio de cada pantalla). Aporta:
//   * Lectura de la sesión guardada en sessionStorage.
//   * protegerVista(): el portero de cada página.
//   * Las alertas visuales (SweetAlert) que usa todo el sistema.
//   * El monitor que avisa de nuevas alertas cada 5 segundos.
// IMPORTANTE: los permisos aquí son solo para la interfaz (ocultar botones).
// La seguridad real la aplica el backend en cada endpoint.
// ============================================================================

// Fecha "YYYY-MM-DD" según el reloj del equipo (hora local). NO usar
// toISOString() para "hoy": entrega la fecha en UTC y después de las 7 p. m.
// en Colombia ya sería mañana.
function fechaLocalISO(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

// Escapa texto antes de insertarlo con innerHTML para evitar XSS con datos
// que vienen de la base de datos (nombres de máquinas, operarios, etc.).
function escapeHtml(valor = '') {
  const div = document.createElement('div');
  div.textContent = String(valor); // textContent nunca interpreta HTML
  return div.innerHTML; // Devuelve el texto ya con < > & convertidos
}

// Lee la sesion guardada por login.js.
function obtenerSesionActual() {
  try {
    return JSON.parse(sessionStorage.getItem('sesionCombustible')) || null;
  } catch (error) {
    return null; // Si el dato está corrupto, se trata como "sin sesión"
  }
}

// Reservadas por compatibilidad: la sesión real vive en la cookie HttpOnly
// que maneja el servidor, así que aquí no hay nada que activar ni limpiar.
function activarSesionEnNavegador() {}

function limpiarSesionEnNavegador() {}

// Detecta si la pagina actual es el login para no crear redirecciones repetidas.
function esPaginaLogin() {
  const paginaActual = window.location.pathname.split('/').pop();
  return paginaActual === 'login' || paginaActual === '';
}

// Envia al login reemplazando el historial actual.
// replace (en lugar de href) evita que el botón "atrás" regrese a la vista.
function irAlLogin() {
  window.location.replace('login');
}

// Verifica si el usuario tiene permiso para entrar a una vista.
function usuarioTienePermiso(vista) {
  const sesion = obtenerSesionActual();

  if (!sesion) return false;

  // El menú principal siempre es accesible para cualquier usuario con sesión.
  if (String(vista || '').trim().toLowerCase() === 'menu') return true;

  const rol = String(sesion.rol || '').trim().toLowerCase();
  const permisos = Array.isArray(sesion.permisos)
    ? sesion.permisos.map((permiso) => String(permiso).trim().toLowerCase())
    : [];

  if (rol === 'super_administrador') return true; // Acceso total

  // La auditoría es un caso especial: administrador y supervisor entran por su
  // rol, aunque no tengan el permiso asignado explícitamente.
  if (String(vista || '').trim().toLowerCase() === 'auditoria') {
    return ['administrador', 'supervisor'].includes(rol) || permisos.includes('auditoria');
  }

  // Solo el super administrador tiene acceso global.
  // Cualquier otro rol depende EXCLUSIVAMENTE de los permisos
  // guardados para ese usuario.
  return permisos.includes(vista);
}

// Muestra aviso cuando un usuario intenta abrir una vista sin permiso.
// Todas las funciones de alerta siguen el mismo patrón: usan SweetAlert si
// está cargado y, si no, caen al alert() nativo del navegador.
function mostrarAlertaSinPermiso() {
  const mensaje = 'No tienes permiso para entrar a esta vista.';

  if (window.Swal) {
    return Swal.fire({
      icon: 'warning',
      title: 'Acceso no permitido',
      text: mensaje,
      confirmButtonText: 'Entendido'
    });
  }

  alert(mensaje);
  return Promise.resolve(); // Se devuelve promesa para poder encadenar .then()
}

// Muestra una alerta de exito con SweetAlert y deja respaldo si la libreria no carga.
function mostrarAlertaExito(titulo, texto) {
  if (window.Swal) {
    return Swal.fire({
      icon: 'success',
      title: titulo,
      text: texto,
      confirmButtonText: 'Aceptar'
    });
  }

  alert(texto || titulo);
  return Promise.resolve();
}

// Muestra una alerta de error con SweetAlert y deja respaldo si la libreria no carga.
function mostrarAlertaError(titulo, texto) {
  if (window.Swal) {
    return Swal.fire({
      icon: 'error',
      title: titulo,
      text: texto,
      confirmButtonText: 'Aceptar'
    });
  }

  alert(texto || titulo);
  return Promise.resolve();
}

// Confirma una accion delicada, como eliminar registros.
// Devuelve true si el usuario confirmó, false si canceló.
async function confirmarAccion(titulo, texto, textoConfirmar = 'Si, eliminar') {
  if (window.Swal) {
    const resultado = await Swal.fire({
      icon: 'warning',
      title: titulo,
      text: texto,
      showCancelButton: true,
      confirmButtonText: textoConfirmar,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef6259', // Rojo: acción destructiva
      cancelButtonColor: '#2b3136'
    });

    return resultado.isConfirmed;
  }

  return confirm(texto || titulo);
}

// Pide un motivo obligatorio antes de anular un registro/operario/máquina.
// Ya no se borra nada físicamente: el backend convierte esto en un estado
// ANULADO y guarda quién y por qué, así que siempre se necesita un motivo.
async function solicitarMotivoAnulacion(titulo, texto) {
  if (window.Swal) {
    const resultado = await Swal.fire({
      icon: 'warning',
      title: titulo,
      // Se inyecta un textarea dentro del cuadro de diálogo.
      html: `<p style="margin:0 0 12px;text-align:left">${texto}</p><textarea id="motivo-anulacion" class="swal2-textarea" placeholder="Motivo de la anulación (obligatorio)"></textarea>`,
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef6259',
      cancelButtonColor: '#2b3136',
      // preConfirm valida antes de cerrar: sin motivo no deja continuar.
      preConfirm: () => {
        const motivo = String(document.getElementById('motivo-anulacion').value || '').trim();
        if (!motivo) {
          Swal.showValidationMessage('El motivo es obligatorio.');
          return false;
        }
        return motivo;
      }
    });

    return resultado.isConfirmed ? resultado.value : null; // null = canceló
  }

  const motivo = prompt(`${texto}\n\nMotivo de la anulación:`);
  return motivo && motivo.trim() ? motivo.trim() : null;
}

// Guarda la ultima vista permitida para regresar ahi si escriben una URL sin permiso.
function guardarUltimaVistaPermitida() {
  const vistaActual = `${window.location.pathname.split('/').pop()}${window.location.search}`;
  sessionStorage.setItem('ultimaVistaPermitida', vistaActual || 'menu');
}

// Protege una pagina completa. Si no tiene permiso, avisa y regresa a la ultima vista permitida.
// CADA PANTALLA DEBE LLAMAR A ESTA FUNCIÓN AL INICIAR (p. ej. protegerVista('tablas')).
function protegerVista(vista) {
  const sesion = obtenerSesionActual();

  // 1) Sin sesión -> al login.
  if (!sesion) {
    irAlLogin();
    return false;
  }

  // 2) Con contraseña temporal -> obligado a cambiarla primero.
  if (sesion.debeCambiarContrasena && vista !== 'cambiar-contrasena') {
    window.location.replace('cambiar-contrasena');
    return false;
  }

  // 3) Sin permiso sobre esta vista -> aviso y regreso a donde estaba.
  if (!usuarioTienePermiso(vista)) {
    const ultimaVista = sessionStorage.getItem('ultimaVistaPermitida') || 'menu';

    mostrarAlertaSinPermiso().then(() => {
      window.location.href = ultimaVista;
    });
    return false;
  }

  guardarUltimaVistaPermitida();
  return true; // Vía libre: la pantalla puede cargar sus datos
}

// Protege el menu principal sin exigir un permiso especifico.
function protegerMenuPrincipal() {
  const sesion = obtenerSesionActual();
  if (!sesion) {
    irAlLogin();
    return false;
  }

  if (sesion.debeCambiarContrasena) {
    window.location.replace('cambiar-contrasena');
    return false;
  }

  guardarUltimaVistaPermitida();
  return true;
}

// Cierra la sesion actual y regresa al login.
async function cerrarSesion() {
  // Gancho opcional: una pantalla puede definir window.validarAntesDeCerrarSesion
  // para impedir la salida si hay trabajo sin guardar (lo usa el registro diario).
  if (window.validarAntesDeCerrarSesion) {
    const puedeCerrar = await window.validarAntesDeCerrarSesion();

    if (!puedeCerrar) {
      return;
    }
  }

  // Este equipo deja de recibir las notificaciones push de este usuario (pwa.js).
  if (window.desactivarPushEnEsteEquipo) await window.desactivarPushEnEsteEquipo();

  // Se avisa al servidor para que borre la sesión y la cookie. Si falla la red
  // igual se limpia el navegador, para no dejar al usuario atrapado.
  try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
  sessionStorage.clear();
  limpiarSesionEnNavegador();
  irAlLogin();
}

// Si el usuario vuelve con la flecha del navegador despues de cerrar sesion, se bloquea la vista.
function validarSesionAlVolver() {
  if (!esPaginaLogin() && !obtenerSesionActual()) {
    irAlLogin();
  }
}

// Tres momentos en que se revalida la sesión:
window.addEventListener('pageshow', validarSesionAlVolver); // Al mostrarse la página (incluye caché del "atrás")
window.addEventListener('popstate', validarSesionAlVolver); // Al navegar con atrás/adelante
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') validarSesionAlVolver(); // Al volver a la pestaña
});

// Bloquea enlaces marcados con data-vista si el usuario no tiene permiso.
// En el HTML cada botón/enlace lleva data-vista="tablas", data-vista="reportes", etc.
function aplicarPermisosEnlaces() {
  const sesion = obtenerSesionActual();
  if (!sesion) return;

  const rol = String(sesion.rol || '').trim().toLowerCase();
  const permisos = Array.isArray(sesion.permisos)
    ? sesion.permisos.map((permiso) => String(permiso).trim().toLowerCase())
    : [];
  const esSuperAdministrador = rol === 'super_administrador';
  const tieneAccesoAuditoria = ['administrador', 'supervisor'].includes(rol) || permisos.includes('auditoria');

  // IMPORTANTE: en el menu principal los accesos sin permiso se eliminan
  // visualmente. No se dejan como botones deshabilitados.
  document.querySelectorAll('[data-menu-principal="true"] [data-vista]').forEach((elemento) => {
    const vista = String(elemento.dataset.vista || '').trim().toLowerCase();
    const permitido =
      vista === 'menu' ||
      esSuperAdministrador ||
      (vista === 'auditoria' ? tieneAccesoAuditoria : permisos.includes(vista));

    // Se oculta de tres maneras para cubrir navegadores y lectores de pantalla.
    elemento.hidden = !permitido;
    elemento.setAttribute('aria-hidden', String(!permitido));
    elemento.style.display = permitido ? '' : 'none';
  });

  // En enlaces internos fuera del menu, se conserva el bloqueo con alerta.
  document.querySelectorAll('[data-vista]:not([data-menu-principal="true"] [data-vista])').forEach((elemento) => {
    if (!usuarioTienePermiso(elemento.dataset.vista)) {
      elemento.classList.add('sin-permiso'); // Estilo gris (ver styles.css)
      elemento.setAttribute('aria-disabled', 'true');
      elemento.setAttribute('title', 'No tienes permiso para entrar a esta vista');
      elemento.addEventListener('click', (evento) => {
        evento.preventDefault(); // Cancela la navegación
        mostrarAlertaSinPermiso();
      });
    }
  });

  // Elementos marcados con data-rol="x" solo se ven si el rol coincide.
  document.querySelectorAll('[data-rol]').forEach((elemento) => {
    if (rol !== String(elemento.dataset.rol || '').trim().toLowerCase()) {
      elemento.hidden = true;
      elemento.style.display = 'none';
    }
  });

  // Traza en la consola del navegador, útil para depurar permisos.
  console.info('[Permisos] Usuario:', sesion.usuario, '| Rol:', rol, '| Permisos:', permisos);
}


// Vigila nuevas alertas de sobrecapacidad mientras cualquier usuario autorizado
// permanece dentro de una vista. No se ejecuta en alertas.html para evitar que
// la misma notificación vuelva a abrirse mientras se está consultando la tabla.
let monitorAlertasIniciado = false; // Evita montar el monitor dos veces
let monitorRevisionEnCurso = false; // Evita consultas superpuestas
const alertasNotificadasEnSesion = new Set(); // Ids ya mostrados en esta sesión

function iniciarMonitorAlertas() {
  if (monitorAlertasIniciado) return;
  const sesion = obtenerSesionActual();
  const paginaActual = window.location.pathname.split('/').pop();
  const rolesPermitidos = ['super_administrador', 'supervisor', 'administrador'];

  // Condiciones para NO activar el monitor.
  if (!sesion || !usuarioTienePermiso('alertas')) return;
  if (paginaActual === 'alertas') return; // Ya está viendo las alertas
  if (!window.fetch) return; // Navegador demasiado antiguo

  monitorAlertasIniciado = true;

  const revisar = async () => {
    if (monitorRevisionEnCurso) return; // Aún respondiendo la consulta anterior
    const sesionActual = obtenerSesionActual();
    if (!sesionActual || !usuarioTienePermiso('alertas')) return;

    monitorRevisionEnCurso = true;
    try {
      const respuesta = await fetch('/api/notificaciones', {

        cache: 'no-store' // Siempre datos frescos, nunca de la caché
      });
      if (!respuesta.ok) return;

      const notificaciones = await respuesta.json();
      const pendientes = notificaciones.filter((n) => Number(n.leida) === 0);
      // Solo se muestra una alerta por ciclo y nunca la misma dos veces.
      const nueva = pendientes.find((n) => !alertasNotificadasEnSesion.has(String(n.id)));
      if (!nueva || !window.Swal) return;

      alertasNotificadasEnSesion.add(String(nueva.id));

      const resultado = await Swal.fire({
        icon: 'warning',
        title: nueva.titulo || 'Nueva alerta de sobrecapacidad',
        text: nueva.mensaje,
        showCancelButton: true,
        confirmButtonText: 'Ver alerta',
        cancelButtonText: 'Después',
        allowOutsideClick: false // Obliga a decidir
      });

      if (!resultado.isConfirmed) return;

      // IMPORTANTE: ver la alerta NO la marca como leída.
      // La notificación permanece pendiente hasta que la alerta sea justificada.
      window.location.replace('alertas');
    } catch (error) {
      console.warn('No se pudieron consultar las alertas:', error);
    } finally {
      monitorRevisionEnCurso = false;
    }
  };

  revisar(); // Primera revisión inmediata
  window.setInterval(revisar, 5000); // Y luego cada 5 segundos (cambiar aquí la frecuencia)
}

// auth.js se carga en las vistas protegidas y SweetAlert se carga antes de este archivo.
iniciarMonitorAlertas();
