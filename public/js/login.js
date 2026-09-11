// ============================================================================
// login.js — PANTALLA DE INICIO DE SESIÓN (public/html/login.html)
// ----------------------------------------------------------------------------
// Envía usuario y contraseña a /api/login. Si el servidor responde bien:
//   * guarda los datos del usuario en sessionStorage (para pintar la interfaz),
//   * el servidor deja aparte la cookie de sesión (esa es la seguridad real),
//   * y redirige al menú o al cambio de contraseña obligatorio.
// ============================================================================

// Referencias a los elementos del formulario en login.html.
const formularioLogin = document.getElementById('formulario-login');
const usuario = document.getElementById('usuario');
const contrasena = document.getElementById('contrasena');
const mensajeLogin = document.getElementById('mensaje-login'); // Texto de error bajo el formulario

// Muestra avisos del login con SweetAlert y deja respaldo si no carga la libreria.
function mostrarAvisoLogin(tipo, titulo, texto) {
  if (window.Swal) {
    return Swal.fire({
      icon: tipo, // 'success' o 'error'
      title: titulo,
      text: texto,
      confirmButtonText: 'Aceptar'
    });
  }

  alert(texto || titulo);
  return Promise.resolve();
}

// Guarda la sesion en el navegador despues de validar con Node y MySQL.
// OJO: esto es solo para la interfaz (saber el rol y qué menús mostrar).
// La autenticación real viaja en la cookie HttpOnly que no se ve desde aquí.
function guardarSesionTemporal(datosSesion) {
  const sesion = {
    id: datosSesion.id,
    usuario: datosSesion.usuario,
    rol: datosSesion.rol,
    permisos: datosSesion.permisos || [], // Vistas habilitadas
    debeCambiarContrasena: Boolean(datosSesion.debeCambiarContrasena),
    fechaIngreso: new Date().toISOString()
  };

  // sessionStorage se borra al cerrar la pestaña (más seguro que localStorage).
  sessionStorage.setItem('sesionCombustible', JSON.stringify(sesion));
}

// Consulta el servidor Node, que valida contra la tabla usuarios_combustible.
async function iniciarSesionEnServidor() {
  const respuesta = await fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      usuario: usuario.value.trim(),
      contrasena: contrasena.value.trim()
    })
  });

  const datos = await respuesta.json();

  // respuesta.ok es false ante 401 (credenciales) o 429 (demasiados intentos).
  if (!respuesta.ok) {
    throw new Error(datos.mensaje || 'No se pudo iniciar sesion.');
  }

  return datos;
}

// Controla el envio del formulario de inicio de sesion.
formularioLogin.addEventListener('submit', async (evento) => {
  evento.preventDefault(); // Evita que la página se recargue
  mensajeLogin.textContent = ''; // Limpia el error anterior

  try {
    const datosSesion = await iniciarSesionEnServidor();
    guardarSesionTemporal(datosSesion);

    await mostrarAvisoLogin('success', 'Sesion iniciada', `Bienvenido ${datosSesion.usuario}.`);

    // Todos los roles entran primero al menu principal.
    // En menu.html se bloquean los botones de las vistas sin permiso.
    window.location.href = datosSesion.debeCambiarContrasena ? 'cambiar-contrasena' : 'menu';
  } catch (error) {
    // El error se muestra en dos lugares: bajo el formulario y en el diálogo.
    mensajeLogin.textContent = error.message;
    mostrarAvisoLogin('error', 'No se pudo iniciar sesion', error.message);
  }
});
