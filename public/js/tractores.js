const formularioTractor = document.getElementById('formulario-tractor');
const tractorMaquina = document.getElementById('tractor-maquina');
const tractorDescripcion = document.getElementById('tractor-descripcion-form');
const tractorCentroCosto = document.getElementById('tractor-centro-costo-form');
const tractorCapacidad = document.getElementById('tractor-capacidad-form');
const cuerpoTablaTractores = document.getElementById('cuerpo-tabla-tractores');
const cantidadTractores = document.getElementById('cantidad-tractores');

// Envia el rol en la cabecera para permitir acciones administrativas.
function obtenerCabecerasTractores() {
  const sesion = obtenerSesionActual();

  return {
    'Content-Type': 'application/json',
    
  };
}

// Consulta los tractores guardados en MySQL.
async function cargarTractores() {
  const respuesta = await fetch('/api/tractores');
  const tractores = await respuesta.json();

  pintarTractores(tractores);
}

// Pinta la tabla de tractores en pantalla.
function pintarTractores(tractores) {
  cuerpoTablaTractores.innerHTML = '';
  cantidadTractores.textContent = tractores.length;

  if (!tractores.length) {
    cuerpoTablaTractores.innerHTML = `
      <div class="estado-vacio-cartas">
        <span class="estado-vacio-icono">🚜</span>
        <strong>No hay tractores registrados</strong>
        <p>Agrega la primera máquina usando el formulario superior.</p>
      </div>`;
    return;
  }

  tractores.forEach((tractor) => {
    const capacidad = Number(tractor.capacidad_galones ?? tractor.capacidad ?? 0);
    const tarjeta = document.createElement('article');
    tarjeta.className = 'carta-registro carta-tractor';
    tarjeta.dataset.tractorId = tractor.id;

    tarjeta.innerHTML = `
      <div class="carta-tractor-top">
        <div>
          <span class="etiqueta-registro">MÁQUINA #${tractor.item ?? '—'}</span>
          <h3 class="maquina-registro"></h3>
          <p class="descripcion-registro"></p>
        </div>
        <div class="icono-tractor-card">🚜</div>
      </div>
      <div class="datos-tractor-card">
        <div class="dato-registro"><span>Centro de costo</span><strong class="centro-registro"></strong></div>
        <div class="dato-registro"><span>Capacidad del tanque</span><strong class="capacidad-registro"></strong></div>
      </div>
      <div class="acciones-registro"></div>`;

    tarjeta.querySelector('.maquina-registro').textContent = tractor.maquina || 'SIN MÁQUINA';
    tarjeta.querySelector('.descripcion-registro').textContent = tractor.descripcion || 'Sin descripción';
    tarjeta.querySelector('.centro-registro').textContent = tractor.centro_costo || '—';
    tarjeta.querySelector('.capacidad-registro').textContent = `${Number.isFinite(capacidad) ? capacidad.toFixed(2) : '0.00'} gal`;

    const botonEditar = document.createElement('button');
    botonEditar.type = 'button';
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'boton-accion-card';
    botonEditar.addEventListener('click', () => activarEdicionTractor(tarjeta, tractor));

    const botonEliminar = document.createElement('button');
    botonEliminar.type = 'button';
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'boton-eliminar boton-accion-card';
    botonEliminar.addEventListener('click', () => eliminarTractor(tractor.id));

    tarjeta.querySelector('.acciones-registro').append(botonEditar, botonEliminar);
    cuerpoTablaTractores.appendChild(tarjeta);
  });
}

function activarEdicionTractor(tarjeta, tractor) {
  const capacidad = Number(tractor.capacidad_galones ?? tractor.capacidad ?? 0);
  tarjeta.classList.add('carta-en-edicion');
  tarjeta.innerHTML = `
    <div class="edicion-carta-titulo">
      <span class="etiqueta-registro">EDITANDO MÁQUINA #${tractor.item ?? '—'}</span>
      <h3>Actualizar tractor</h3>
    </div>
    <div class="form-edicion-card">
      <label>Máquina<input class="ed-maquina" type="text" maxlength="20" required></label>
      <label>Descripción<input class="ed-descripcion" type="text" maxlength="150" required></label>
      <label>Centro de costo<input class="ed-centro" type="text" maxlength="20" required></label>
      <label>Capacidad (galones)<input class="ed-capacidad" type="number" min="0" step="0.01" required></label>
    </div>
    <div class="acciones-registro"></div>`;

  tarjeta.querySelector('.ed-maquina').value = tractor.maquina ?? '';
  tarjeta.querySelector('.ed-descripcion').value = tractor.descripcion ?? '';
  tarjeta.querySelector('.ed-centro').value = tractor.centro_costo ?? '';
  tarjeta.querySelector('.ed-capacidad').value = Number.isFinite(capacidad) ? capacidad : 0;

  const acciones = tarjeta.querySelector('.acciones-registro');
  const botonGuardar = document.createElement('button');
  botonGuardar.type = 'button';
  botonGuardar.textContent = 'Guardar cambios';
  botonGuardar.addEventListener('click', () => guardarEdicionTractor(tarjeta, tractor));

  const botonCancelar = document.createElement('button');
  botonCancelar.type = 'button';
  botonCancelar.textContent = 'Cancelar';
  botonCancelar.className = 'boton-secundario';
  botonCancelar.addEventListener('click', cargarTractores);

  acciones.append(botonGuardar, botonCancelar);
}
async function guardarEdicionTractor(tarjeta, tractor) {
  const datos = {
    maquina: tarjeta.querySelector('.ed-maquina').value.trim().toUpperCase(),
    descripcion: tarjeta.querySelector('.ed-descripcion').value.trim().toUpperCase(),
    centro_costo: tarjeta.querySelector('.ed-centro').value.trim().toUpperCase(),
    capacidad_galones: Number(tarjeta.querySelector('.ed-capacidad').value || 0)
  };

  if (!datos.maquina || !datos.descripcion || !datos.centro_costo || !Number.isFinite(datos.capacidad_galones)) {
    mostrarAlertaError('Datos incompletos', 'Completa todos los campos del tractor.');
    return;
  }

  const respuesta = await fetch(`/api/tractores/${tractor.id}`, {
    method: 'PUT',
    headers: obtenerCabecerasTractores(),
    body: JSON.stringify(datos)
  });

  if (!respuesta.ok) {
    mostrarAlertaError('No se pudo guardar', 'No se pudo guardar la edicion del tractor.');
    return;
  }

  await cargarTractores();
  mostrarAlertaExito('Tractor actualizado', 'Los cambios fueron guardados correctamente.');
}

// Agrega un tractor nuevo en MySQL.
formularioTractor.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  await fetch('/api/tractores', {
    method: 'POST',
    headers: obtenerCabecerasTractores(),
    body: JSON.stringify({
      maquina: tractorMaquina.value.trim().toUpperCase(),
      descripcion: tractorDescripcion.value.trim().toUpperCase(),
      centro_costo: tractorCentroCosto.value.trim().toUpperCase(),
      capacidad_galones: Number(tractorCapacidad.value || 0)
    })
  });

  formularioTractor.reset();
  await cargarTractores();
  mostrarAlertaExito('Tractor agregado', 'El tractor fue agregado correctamente.');
});

// Elimina un tractor sin tocar los registros historicos ya guardados.
async function eliminarTractor(id) {
  const confirmado = await confirmarAccion(
    'Eliminar tractor',
    'Desea eliminar este tractor? Los registros guardados no se borraran.',
    'Si, eliminar'
  );

  if (!confirmado) {
    return;
  }

  await fetch(`/api/tractores/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasTractores()
  });

  await cargarTractores();
  mostrarAlertaExito('Tractor eliminado', 'El tractor fue eliminado correctamente.');
}

cargarTractores();
