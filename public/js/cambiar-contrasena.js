// ============================================================================
// cambiar-contrasena.js — PANTALLA DE CAMBIO OBLIGATORIO DE CONTRASEÑA
// ----------------------------------------------------------------------------
// A esta pantalla se llega automáticamente cuando el usuario entra con la
// contraseña temporal (123456). No deja continuar al sistema hasta cambiarla.
// Las mismas reglas se validan otra vez en el servidor (user.service.js).
// ============================================================================

// Elementos del formulario en cambiar-contrasena.html.
const sesionCambio = obtenerSesionActual();
const formularioCambio = document.getElementById('formulario-cambiar-contrasena');
const actualCambio = document.getElementById('contrasena-actual');
const nuevaCambio = document.getElementById('nueva-contrasena');
const confirmarCambio = document.getElementById('confirmar-contrasena');
const mensajeCambio = document.getElementById('mensaje-cambiar-contrasena'); // Línea de error

// Control de acceso a la pantalla:
if (!sesionCambio) {
  irAlLogin(); // Sin sesión: al login
} else if (!sesionCambio.debeCambiarContrasena) {
  window.location.replace('menu'); // Ya la cambió: no tiene nada que hacer aquí
}

formularioCambio.addEventListener('submit', async (evento) => {
  evento.preventDefault(); // Evita que se recargue la página
  mensajeCambio.textContent = '';

  // Validación 1: las dos contraseñas nuevas deben coincidir.
  if (nuevaCambio.value !== confirmarCambio.value) {
    mensajeCambio.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }

  // Validación 2: no puede quedarse con la clave temporal.
  if (nuevaCambio.value === '123456') {
    mensajeCambio.textContent = 'La nueva contraseña no puede seguir siendo 123456.';
    return;
  }

  try {
    const respuesta = await fetch('/api/cambiar-contrasena', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id: sesionCambio.id, // El servidor lo ignora: usa el id de la sesión
        contrasenaActual: actualCambio.value,
        nuevaContrasena: nuevaCambio.value
      })
    });

    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo cambiar la contraseña.');

    // Se apaga la bandera en la sesión local para que ya no vuelva a redirigir.
    const sesionActualizada = {...sesionCambio, debeCambiarContrasena: false};
    sessionStorage.setItem('sesionCombustible', JSON.stringify(sesionActualizada));
    await mostrarAlertaExito('Contraseña actualizada', 'Ya puedes continuar al sistema.');
    window.location.replace('menu');
  } catch (error) {
    mensajeCambio.textContent = error.message;
    mostrarAlertaError('No se pudo cambiar la contraseña', error.message);
  }
});
