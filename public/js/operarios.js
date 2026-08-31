const formularioOperario = document.getElementById('formulario-operario');
const operarioNombre = document.getElementById('operario-nombre');
const operarioCedula = document.getElementById('operario-cedula');
const cuerpoTablaOperarios = document.getElementById('cuerpo-tabla-operarios');
const cantidadOperarios = document.getElementById('cantidad-operarios');

// Envia el rol en la cabecera para permitir acciones administrativas.
function obtenerCabecerasOperarios() {
  const sesion = obtenerSesionActual();

  return {
    'Content-Type': 'application/json',
    
  };
}

// Consulta los operarios guardados en MySQL.
async function cargarOperarios() {
  const respuesta = await fetch('/api/operarios');
  const operarios = await respuesta.json();

  pintarOperarios(operarios);
}

// Pinta la tabla de operarios en pantalla.
function pintarOperarios(operarios) {
  cuerpoTablaOperarios.innerHTML = '';
  cantidadOperarios.textContent = operarios.length;

  if (!operarios.length) {
    cuerpoTablaOperarios.innerHTML = `
      <div class="estado-vacio-cartas">
        <span class="estado-vacio-icono">👤</span>
        <strong>No hay operarios registrados</strong>
        <p>Agrega el primer operario usando el formulario superior.</p>
      </div>`;
    return;
  }

  operarios.forEach((operario) => {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'carta-registro carta-operario';

    const nombre = String(operario.nombre || 'SIN NOMBRE');
    const iniciales = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();

    tarjeta.innerHTML = `
      <div class="carta-registro-cabecera">
        <div class="avatar-registro">${iniciales || 'OP'}</div>
        <div class="carta-registro-titulo">
          <span class="etiqueta-registro">OPERARIO</span>
          <h3></h3>
        </div>
      </div>
      <div class="dato-registro">
        <span>Cédula</span>
        <strong class="cedula-registro"></strong>
      </div>
      <div class="acciones-registro"></div>`;

    tarjeta.querySelector('h3').textContent = nombre;
    tarjeta.querySelector('.cedula-registro').textContent = operario.cedula ?? '—';

    const botonEliminar = document.createElement('button');
    botonEliminar.type = 'button';
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'boton-eliminar boton-accion-card';
    botonEliminar.addEventListener('click', () => eliminarOperario(operario.id));
    tarjeta.querySelector('.acciones-registro').appendChild(botonEliminar);

    cuerpoTablaOperarios.appendChild(tarjeta);
  });
}

// Agrega un operario nuevo en MySQL.
formularioOperario.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const respuesta = await fetch('/api/operarios', {
    method: 'POST',
    headers: obtenerCabecerasOperarios(),
    body: JSON.stringify({
      nombre: operarioNombre.value.trim().toUpperCase(),
      cedula: operarioCedula.value.trim()
    })
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo guardar', payload.mensaje || 'No tienes permiso para registrar operarios.');
    return;
  }

  formularioOperario.reset();
  await cargarOperarios();
  mostrarAlertaExito('Operario agregado', 'El operario fue agregado correctamente.');
});

// Elimina un operario sin tocar los registros historicos ya guardados.
async function eliminarOperario(id) {
  const confirmado = await confirmarAccion(
    'Eliminar operario',
    'Desea eliminar este operario? Los registros guardados no se borraran.',
    'Si, eliminar'
  );

  if (!confirmado) {
    return;
  }

  const respuesta = await fetch(`/api/operarios/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasOperarios()
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo eliminar', payload.mensaje || 'No tienes permiso para eliminar operarios.');
    return;
  }

  await cargarOperarios();
  mostrarAlertaExito('Operario eliminado', 'El operario fue eliminado correctamente.');
}

cargarOperarios();
