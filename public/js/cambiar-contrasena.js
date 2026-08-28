const sesionCambio = obtenerSesionActual();
const formularioCambio = document.getElementById('formulario-cambiar-contrasena');
const actualCambio = document.getElementById('contrasena-actual');
const nuevaCambio = document.getElementById('nueva-contrasena');
const confirmarCambio = document.getElementById('confirmar-contrasena');
const mensajeCambio = document.getElementById('mensaje-cambiar-contrasena');

if (!sesionCambio) {
  irAlLogin();
} else if (!sesionCambio.debeCambiarContrasena) {
  window.location.replace('menu.html');
}

formularioCambio.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  mensajeCambio.textContent = '';

  if (nuevaCambio.value !== confirmarCambio.value) {
    mensajeCambio.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }

  if (nuevaCambio.value === '123456') {
    mensajeCambio.textContent = 'La nueva contraseña no puede seguir siendo 123456.';
    return;
  }

  try {
    const respuesta = await fetch('/api/cambiar-contrasena', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id: sesionCambio.id,
        contrasenaActual: actualCambio.value,
        nuevaContrasena: nuevaCambio.value
      })
    });

    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo cambiar la contraseña.');

    const sesionActualizada = {...sesionCambio, debeCambiarContrasena: false};
    sessionStorage.setItem('sesionCombustible', JSON.stringify(sesionActualizada));
    await mostrarAlertaExito('Contraseña actualizada', 'Ya puedes continuar al sistema.');
    window.location.replace('menu.html');
  } catch (error) {
    mensajeCambio.textContent = error.message;
    mostrarAlertaError('No se pudo cambiar la contraseña', error.message);
  }
});
