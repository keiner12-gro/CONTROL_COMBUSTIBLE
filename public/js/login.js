const formularioLogin = document.getElementById('formulario-login');
const usuario = document.getElementById('usuario');
const contrasena = document.getElementById('contrasena');
const mensajeLogin = document.getElementById('mensaje-login');

// Muestra avisos del login con SweetAlert y deja respaldo si no carga la libreria.
function mostrarAvisoLogin(tipo, titulo, texto) {
  if (window.Swal) {
    return Swal.fire({
      icon: tipo,
      title: titulo,
      text: texto,
      confirmButtonText: 'Aceptar'
    });
  }

  alert(texto || titulo);
  return Promise.resolve();
}

// Guarda la sesion en el navegador despues de validar con Node y MySQL.
function guardarSesionTemporal(datosSesion) {
  const sesion = {
    id: datosSesion.id,
    usuario: datosSesion.usuario,
    rol: datosSesion.rol,
    permisos: datosSesion.permisos || [],
    debeCambiarContrasena: Boolean(datosSesion.debeCambiarContrasena),
    fechaIngreso: new Date().toISOString()
  };

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

  if (!respuesta.ok) {
    throw new Error(datos.mensaje || 'No se pudo iniciar sesion.');
  }

  return datos;
}

// Controla el envio del formulario de inicio de sesion.
formularioLogin.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mensajeLogin.textContent = '';

  try {
    const datosSesion = await iniciarSesionEnServidor();
    guardarSesionTemporal(datosSesion);

    await mostrarAvisoLogin('success', 'Sesion iniciada', `Bienvenido ${datosSesion.usuario}.`);

    // Todos los roles entran primero al menu principal.
    // En menu.html se bloquean los botones de las vistas sin permiso.
    window.location.href = datosSesion.debeCambiarContrasena ? 'cambiar-contrasena.html' : 'menu.html';
  } catch (error) {
    mensajeLogin.textContent = error.message;
    mostrarAvisoLogin('error', 'No se pudo iniciar sesion', error.message);
  }
});
