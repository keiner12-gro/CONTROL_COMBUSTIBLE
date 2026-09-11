// ============================================================================
// operarios.js — PANTALLA DE OPERARIOS (public/html/operarios.html)
// ----------------------------------------------------------------------------
// Permite ver, agregar y anular operarios. Cada operario se muestra como una
// tarjeta con su avatar de iniciales, nombre y cédula.
// ============================================================================

// Elementos del formulario y del listado.
const formularioOperario = document.getElementById('formulario-operario');
const operarioNombre = document.getElementById('operario-nombre');
const operarioCedula = document.getElementById('operario-cedula');
const cuerpoTablaOperarios = document.getElementById('cuerpo-tabla-operarios');
const cantidadOperarios = document.getElementById('cantidad-operarios');

// Envia el rol en la cabecera para permitir acciones administrativas.
// (Hoy el rol ya no viaja en cabeceras: el servidor lo saca de la cookie de
// sesión. La función se conserva para centralizar las cabeceras de los envíos.)
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
  cuerpoTablaOperarios.innerHTML = ''; // Se limpia antes de redibujar
  cantidadOperarios.textContent = operarios.length;

  // Estado vacío: mensaje guía cuando todavía no hay operarios.
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

    // Iniciales del avatar: "JUAN PEREZ" -> "JP".
    const nombre = String(operario.nombre || 'SIN NOMBRE');
    const iniciales = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]).join('').toUpperCase();

    // La estructura se crea con innerHTML pero SIN datos del usuario dentro;
    // el nombre y la cédula se insertan después con textContent (más seguro).
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

    // Botón de anulación (el texto dice "Eliminar", pero solo anula).
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
      nombre: operarioNombre.value.trim().toUpperCase(), // Siempre en mayúsculas
      cedula: operarioCedula.value.trim()
    })
  });

  // Si el servidor rechaza (sin permiso, datos inválidos), se muestra su mensaje.
  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo guardar', payload.mensaje || 'No tienes permiso para registrar operarios.');
    return;
  }

  formularioOperario.reset(); // Limpia el formulario
  await cargarOperarios(); // Recarga el listado
  mostrarAlertaExito('Operario agregado', 'El operario fue agregado correctamente.');
});

// Anula un operario sin borrar los registros historicos ya guardados.
async function eliminarOperario(id) {
  // El motivo es obligatorio: sin él, el backend rechaza la operación.
  const motivo = await solicitarMotivoAnulacion(
    'Anular operario',
    'El operario no se borrará: quedará anulado y los registros guardados no se modificarán.'
  );

  if (!motivo) {
    return; // El usuario canceló
  }

  const respuesta = await fetch(`/api/operarios/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasOperarios(),
    body: JSON.stringify({ motivo }) // El motivo viaja en el cuerpo del DELETE
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo anular', payload.mensaje || 'No tienes permiso para anular operarios.');
    return;
  }

  await cargarOperarios();
  mostrarAlertaExito('Operario anulado', 'El operario fue anulado correctamente.');
}

cargarOperarios(); // Carga inicial al abrir la pantalla
