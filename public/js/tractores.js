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

// Consumo del mes en curso por maquina, para mostrarlo en cada tarjeta.
// Si el usuario no tiene permiso de "reportes" la consulta falla en
// silencio y las tarjetas simplemente no muestran esa seccion.
async function obtenerConsumoDelMes() {
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);

  try {
    const respuesta = await fetch(`/api/analitica/maquinas?fechaInicio=${inicio}&fechaFin=${fin}`);
    if (!respuesta.ok) return new Map();
    const estadisticas = await respuesta.json();
    return new Map(estadisticas.map((item) => [String(item.maquina || '').toUpperCase(), item]));
  } catch (_) {
    return new Map();
  }
}

// Consulta los tractores guardados en MySQL.
async function cargarTractores() {
  const [respuesta, consumoPorMaquina] = await Promise.all([fetch('/api/tractores'), obtenerConsumoDelMes()]);
  const tractores = await respuesta.json();

  pintarTractores(tractores, consumoPorMaquina);
}

// Extrae el tipo de maquina (Tractor, Camion, Excavadora, etc.) a partir de la
// descripcion ya existente, sin crear un campo nuevo en la base de datos.
function tipoDeMaquina(descripcion) {
  const palabra = String(descripcion || '').trim().split(/\s+/)[0] || '';
  return palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase() : 'Máquina';
}

// Pinta la tabla de maquinas en pantalla.
function pintarTractores(tractores, consumoPorMaquina = new Map()) {
  cuerpoTablaTractores.innerHTML = '';
  cantidadTractores.textContent = tractores.length;

  if (!tractores.length) {
    cuerpoTablaTractores.innerHTML = `
      <div class="estado-vacio-cartas">
        <span class="estado-vacio-icono">🚜</span>
        <strong>No hay máquinas registradas</strong>
        <p>Agrega la primera máquina usando el formulario superior.</p>
      </div>`;
    return;
  }

  tractores.forEach((tractor) => {
    const capacidad = Number(tractor.capacidad_galones ?? tractor.capacidad ?? 0);
    const consumo = consumoPorMaquina.get(String(tractor.maquina || '').toUpperCase());
    const tarjeta = document.createElement('article');
    tarjeta.className = 'carta-registro carta-tractor';
    tarjeta.dataset.tractorId = tractor.id;

    tarjeta.innerHTML = `
      <div class="carta-tractor-top">
        <div>
          <span class="etiqueta-registro">MÁQUINA #${tractor.item ?? '—'}</span>
          <h3 class="maquina-registro"></h3>
          <p class="descripcion-registro"></p>
          <span class="badge-tipo-maquina"></span>
        </div>
        <div class="icono-tractor-card">🚜</div>
      </div>
      <div class="datos-tractor-card">
        <div class="dato-registro"><span>Centro de costo</span><strong class="centro-registro"></strong></div>
        <div class="dato-registro"><span>Capacidad del tanque</span><strong class="capacidad-registro"></strong></div>
      </div>
      <div class="consumo-tractor-card"></div>
      <div class="acciones-registro"></div>`;

    tarjeta.querySelector('.maquina-registro').textContent = tractor.maquina || 'SIN MÁQUINA';
    tarjeta.querySelector('.descripcion-registro').textContent = tractor.descripcion || 'Sin descripción';
    tarjeta.querySelector('.badge-tipo-maquina').textContent = tipoDeMaquina(tractor.descripcion);
    tarjeta.querySelector('.centro-registro').textContent = tractor.centro_costo || '—';
    tarjeta.querySelector('.capacidad-registro').textContent = `${Number.isFinite(capacidad) ? capacidad.toFixed(2) : '0.00'} gal`;

    const bloqueConsumo = tarjeta.querySelector('.consumo-tractor-card');
    if (consumo && Number(consumo.registros) > 0) {
      const totalMes = Number(consumo.totalGalones || 0);
      const porcentaje = capacidad > 0 ? Math.min(100, (totalMes / capacidad) * 100) : 0;
      bloqueConsumo.innerHTML = `
        <div class="fila-consumo"><span>Consumo este mes</span><strong>${totalMes.toFixed(2)} gal</strong></div>
        <div class="barra-consumo-tractor"><span style="width:${porcentaje}%"></span></div>
        <div class="fila-consumo"><span>${consumo.registros} registro${consumo.registros === 1 ? '' : 's'} este mes</span></div>
      `;
    } else {
      bloqueConsumo.innerHTML = `<p class="consumo-tractor-vacio">Sin movimientos este mes.</p>`;
    }

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
      <h3>Actualizar máquina</h3>
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
    mostrarAlertaError('Datos incompletos', 'Completa todos los campos de la máquina.');
    return;
  }

  const respuesta = await fetch(`/api/tractores/${tractor.id}`, {
    method: 'PUT',
    headers: obtenerCabecerasTractores(),
    body: JSON.stringify(datos)
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo guardar', payload.mensaje || 'No tienes permiso para editar máquinas.');
    return;
  }

  await cargarTractores();
  mostrarAlertaExito('Máquina actualizada', 'Los cambios fueron guardados correctamente.');
}

// Agrega un tractor nuevo en MySQL.
formularioTractor.addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const respuesta = await fetch('/api/tractores', {
    method: 'POST',
    headers: obtenerCabecerasTractores(),
    body: JSON.stringify({
      maquina: tractorMaquina.value.trim().toUpperCase(),
      descripcion: tractorDescripcion.value.trim().toUpperCase(),
      centro_costo: tractorCentroCosto.value.trim().toUpperCase(),
      capacidad_galones: Number(tractorCapacidad.value || 0)
    })
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo guardar', payload.mensaje || 'No tienes permiso para registrar máquinas.');
    return;
  }

  formularioTractor.reset();
  await cargarTractores();
  mostrarAlertaExito('Máquina agregada', 'La máquina fue agregada correctamente.');
});

// Anula una maquina sin tocar los registros historicos ya guardados.
async function eliminarTractor(id) {
  const motivo = await solicitarMotivoAnulacion(
    'Anular máquina',
    'La máquina no se borrará: quedará anulada y los registros guardados no se modificarán.'
  );

  if (!motivo) {
    return;
  }

  const respuesta = await fetch(`/api/tractores/${id}`, {
    method: 'DELETE',
    headers: obtenerCabecerasTractores(),
    body: JSON.stringify({ motivo })
  });

  if (!respuesta.ok) {
    const payload = await respuesta.json().catch(() => ({}));
    mostrarAlertaError('No se pudo anular', payload.mensaje || 'No tienes permiso para anular máquinas.');
    return;
  }

  await cargarTractores();
  mostrarAlertaExito('Máquina anulada', 'La máquina fue anulada correctamente.');
}

cargarTractores();
