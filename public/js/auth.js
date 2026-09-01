// Escapa texto antes de insertarlo con innerHTML para evitar XSS con datos
// que vienen de la base de datos (nombres de máquinas, operarios, etc.).
function escapeHtml(valor = '') {
  const div = document.createElement('div');
  div.textContent = String(valor);
  return div.innerHTML;
}

// Lee la sesion guardada por login.js.
function obtenerSesionActual() {
  try {
    return JSON.parse(sessionStorage.getItem('sesionCombustible')) || null;
  } catch (error) {
    return null;
  }
}

function activarSesionEnNavegador() {}

function limpiarSesionEnNavegador() {}

// Detecta si la pagina actual es el login para no crear redirecciones repetidas.
function esPaginaLogin() {
  const paginaActual = window.location.pathname.split('/').pop();
  return paginaActual === 'login' || paginaActual === '';
}

// Envia al login reemplazando el historial actual.
function irAlLogin() {
  window.location.replace('login');
}

// Verifica si el usuario tiene permiso para entrar a una vista.
function usuarioTienePermiso(vista) {
  const sesion = obtenerSesionActual();

  if (!sesion) return false;

  if (String(vista || '').trim().toLowerCase() === 'menu') return true;

  const rol = String(sesion.rol || '').trim().toLowerCase();
  const permisos = Array.isArray(sesion.permisos)
    ? sesion.permisos.map((permiso) => String(permiso).trim().toLowerCase())
    : [];

  if (rol === 'super_administrador') return true;

  if (String(vista || '').trim().toLowerCase() === 'auditoria') {
    return ['administrador', 'supervisor'].includes(rol) || permisos.includes('auditoria');
  }

  // Solo el super administrador tiene acceso global.
  // Cualquier otro rol depende EXCLUSIVAMENTE de los permisos
  // guardados para ese usuario.
  return permisos.includes(vista);
}

// Muestra aviso cuando un usuario intenta abrir una vista sin permiso.
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
  return Promise.resolve();
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
async function confirmarAccion(titulo, texto, textoConfirmar = 'Si, eliminar') {
  if (window.Swal) {
    const resultado = await Swal.fire({
      icon: 'warning',
      title: titulo,
      text: texto,
      showCancelButton: true,
      confirmButtonText: textoConfirmar,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef6259',
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
      html: `<p style="margin:0 0 12px;text-align:left">${texto}</p><textarea id="motivo-anulacion" class="swal2-textarea" placeholder="Motivo de la anulación (obligatorio)"></textarea>`,
      showCancelButton: true,
      confirmButtonText: 'Anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef6259',
      cancelButtonColor: '#2b3136',
      preConfirm: () => {
        const motivo = String(document.getElementById('motivo-anulacion').value || '').trim();
        if (!motivo) {
          Swal.showValidationMessage('El motivo es obligatorio.');
          return false;
        }
        return motivo;
      }
    });

    return resultado.isConfirmed ? resultado.value : null;
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
function protegerVista(vista) {
  const sesion = obtenerSesionActual();

  if (!sesion) {
    irAlLogin();
    return false;
  }

  if (sesion.debeCambiarContrasena && vista !== 'cambiar-contrasena') {
    window.location.replace('cambiar-contrasena');
    return false;
  }

  if (!usuarioTienePermiso(vista)) {
    const ultimaVista = sessionStorage.getItem('ultimaVistaPermitida') || 'menu';

    mostrarAlertaSinPermiso().then(() => {
      window.location.href = ultimaVista;
    });
    return false;
  }

  guardarUltimaVistaPermitida();
  return true;
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
  if (window.validarAntesDeCerrarSesion) {
    const puedeCerrar = await window.validarAntesDeCerrarSesion();

    if (!puedeCerrar) {
      return;
    }
  }

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

window.addEventListener('pageshow', validarSesionAlVolver);
window.addEventListener('popstate', validarSesionAlVolver);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') validarSesionAlVolver();
});

// Bloquea enlaces marcados con data-vista si el usuario no tiene permiso.
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

    elemento.hidden = !permitido;
    elemento.setAttribute('aria-hidden', String(!permitido));
    elemento.style.display = permitido ? '' : 'none';
  });

  // En enlaces internos fuera del menu, se conserva el bloqueo con alerta.
  document.querySelectorAll('[data-vista]:not([data-menu-principal="true"] [data-vista])').forEach((elemento) => {
    if (!usuarioTienePermiso(elemento.dataset.vista)) {
      elemento.classList.add('sin-permiso');
      elemento.setAttribute('aria-disabled', 'true');
      elemento.setAttribute('title', 'No tienes permiso para entrar a esta vista');
      elemento.addEventListener('click', (evento) => {
        evento.preventDefault();
        mostrarAlertaSinPermiso();
      });
    }
  });

  document.querySelectorAll('[data-rol]').forEach((elemento) => {
    if (rol !== String(elemento.dataset.rol || '').trim().toLowerCase()) {
      elemento.hidden = true;
      elemento.style.display = 'none';
    }
  });

  console.info('[Permisos] Usuario:', sesion.usuario, '| Rol:', rol, '| Permisos:', permisos);
}


// Vigila nuevas alertas de sobrecapacidad mientras cualquier usuario autorizado
// permanece dentro de una vista. No se ejecuta en alertas.html para evitar que
// la misma notificación vuelva a abrirse mientras se está consultando la tabla.
let monitorAlertasIniciado = false;
let monitorRevisionEnCurso = false;
const alertasNotificadasEnSesion = new Set();

function iniciarMonitorAlertas() {
  if (monitorAlertasIniciado) return;
  const sesion = obtenerSesionActual();
  const paginaActual = window.location.pathname.split('/').pop();
  const rolesPermitidos = ['super_administrador', 'supervisor', 'administrador'];

  if (!sesion || !usuarioTienePermiso('alertas')) return;
  if (paginaActual === 'alertas') return;
  if (!window.fetch) return;

  monitorAlertasIniciado = true;

  const revisar = async () => {
    if (monitorRevisionEnCurso) return;
    const sesionActual = obtenerSesionActual();
    if (!sesionActual || !usuarioTienePermiso('alertas')) return;

    monitorRevisionEnCurso = true;
    try {
      const respuesta = await fetch('/api/notificaciones', {
        
        cache: 'no-store'
      });
      if (!respuesta.ok) return;

      const notificaciones = await respuesta.json();
      const pendientes = notificaciones.filter((n) => Number(n.leida) === 0);
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
        allowOutsideClick: false
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

  revisar();
  window.setInterval(revisar, 5000);
}

// auth.js se carga en las vistas protegidas y SweetAlert se carga antes de este archivo.
iniciarMonitorAlertas();
