// ============================================================================
// auditoria.js — PANTALLA DE AUDITORÍA (public/html/auditoria.html)
// ----------------------------------------------------------------------------
// Consulta la bitácora del sistema: quién hizo qué, cuándo y en qué módulo.
// Incluye filtros (fechas, usuario, acción, módulo, búsqueda libre), tarjetas
// de resumen, paginación, ventana de detalle con "antes/después" y, solo para
// el super administrador, las acciones de modificar y eliminar eventos.
// ============================================================================

// Estado de la pantalla: página actual, tamaño de página y total de páginas.
const estadoAuditoria = {
  page: 1,
  limit: 20, // Eventos por página (el backend admite hasta 100)
  totalPages: 1,
  filtros: {}
};

// Elementos de la interfaz.
const modalDetalle = document.getElementById('detalle-auditoria-modal'); // Ventana emergente
const contenidoDetalle = document.getElementById('detalle-auditoria-contenido');
const tablaAuditoria = document.getElementById('tabla-auditoria'); // <tbody> de la tabla
const cantidadAuditoria = document.getElementById('cantidad-auditoria');
const rangoRegistros = document.getElementById('rango-registros');
const paginaActual = document.getElementById('pagina-actual');
// Tarjetas de resumen superiores.
const totalEventos = document.getElementById('total-eventos');
const usuariosUnicos = document.getElementById('usuarios-unicos');
const accionesUnicas = document.getElementById('acciones-unicas');
const modulosUnicos = document.getElementById('modulos-unicos');

// Campos del formulario de filtros, agrupados para recorrerlos con facilidad.
const formFields = {
  desde: document.getElementById('filtro-fecha-desde'),
  hasta: document.getElementById('filtro-fecha-hasta'),
  usuario: document.getElementById('filtro-usuario'),
  accion: document.getElementById('filtro-accion'),
  modulo: document.getElementById('filtro-modulo'),
  busqueda: document.getElementById('filtro-busqueda')
};

// Solo el super administrador ve los botones de modificar/eliminar.
// (El backend vuelve a validarlo: ocultar el botón no es la seguridad real.)
function puedeModificarAuditoria() {
  const sesion = obtenerSesionActual();
  return String(sesion?.rol || '').toLowerCase() === 'super_administrador';
}

// Arma la cadena de consulta (?page=1&limit=20&usuario=...) a partir de los
// filtros que estén llenos. Se usa tanto para cargar la tabla como para exportar.
function construirQuery() {
  const params = new URLSearchParams();
  params.set('page', String(estadoAuditoria.page));
  params.set('limit', String(estadoAuditoria.limit));

  const filtroDesde = formFields.desde.value;
  const filtroHasta = formFields.hasta.value;
  const filtroUsuario = formFields.usuario.value.trim();
  const filtroAccion = formFields.accion.value;
  const filtroModulo = formFields.modulo.value;
  const filtroBusqueda = formFields.busqueda.value.trim();

  // Solo se envían los filtros con valor, para no ensuciar la URL.
  if (filtroDesde) params.set('fechaDesde', filtroDesde);
  if (filtroHasta) params.set('fechaHasta', filtroHasta);
  if (filtroUsuario) params.set('usuario', filtroUsuario);
  if (filtroAccion) params.set('accion', filtroAccion);
  if (filtroModulo) params.set('modulo', filtroModulo);
  if (filtroBusqueda) params.set('q', filtroBusqueda);

  return params.toString();
}

// Fila única que ocupa toda la tabla cuando no hay resultados.
function vaciarTabla() {
  tablaAuditoria.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="estado-vacio-selector">No hay eventos que coincidan con los filtros seleccionados.</div>
      </td>
    </tr>
  `;
}

// Convierte cualquier valor en texto legible (los objetos, como JSON indentado).
function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'object') return JSON.stringify(valor, null, 2);
  return String(valor);
}

// Fecha y hora en formato colombiano; si no es una fecha válida, se muestra tal cual.
function formatearFecha(fecha) {
  if (!fecha) return '—';
  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return String(fecha);
  return valor.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Llena las cuatro tarjetas de resumen con los totales que calcula el servidor.
function renderResumen(resumen = {}) {
  totalEventos.textContent = Number(resumen.total_eventos || 0);
  usuariosUnicos.textContent = Number(resumen.usuarios_unicos || 0);
  accionesUnicas.textContent = Number(resumen.acciones_unicas || 0);
  modulosUnicos.textContent = Number(resumen.modulos_unicos || 0);
}

// Actualiza el indicador de página y habilita/deshabilita los botones.
function renderPaginacion(page, totalPages) {
  // Se acota la página entre 1 y el total, por si llega un valor fuera de rango.
  estadoAuditoria.page = Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(totalPages) || 1));
  estadoAuditoria.totalPages = Math.max(1, Number(totalPages) || 1);
  paginaActual.textContent = `Página ${estadoAuditoria.page}`;
  const anterior = document.getElementById('pagina-anterior');
  const siguiente = document.getElementById('pagina-siguiente');
  anterior.disabled = estadoAuditoria.page <= 1;
  siguiente.disabled = estadoAuditoria.page >= estadoAuditoria.totalPages;
}

// Normaliza el campo "detalle" (JSON) a un objeto manejable.
function convertirDetalle(detalle) {
  if (!detalle || typeof detalle !== 'object') return {};
  if (Array.isArray(detalle)) return { valores: detalle };
  return detalle;
}

// Dibuja las filas de la tabla con los eventos recibidos.
function renderTabla(registros) {
  if (!Array.isArray(registros) || !registros.length) {
    vaciarTabla();
    cantidadAuditoria.textContent = '0';
    rangoRegistros.textContent = '0';
    return;
  }

  tablaAuditoria.innerHTML = '';
  cantidadAuditoria.textContent = String(registros.length);
  rangoRegistros.textContent = `${registros.length} / ${estadoAuditoria.totalPages * estadoAuditoria.limit}`;

  registros.forEach((registro) => {
    const detalle = convertirDetalle(registro.detalle);
    const fila = document.createElement('tr');

    // Vista previa del detalle: se toma el primer campo del JSON, recortado a
    // 90 caracteres. El contenido completo va en el "title" (tooltip) y en la
    // ventana de detalle.
    const descripcionDetalle = (() => {
      const keys = Object.keys(detalle);
      if (!keys.length) return 'Sin detalle';
      const primer = detailValue => {
        if (typeof detailValue === 'object') return JSON.stringify(detailValue).slice(0, 90);
        return String(detailValue).slice(0, 90);
      };
      return primer(detalle[keys[0]]);
    })();

    // Todo el contenido pasa por escapeHtml porque proviene de la base de datos.
    fila.innerHTML = `
      <td>${escapeHtml(formatearFecha(registro.fecha || registro.creado_en))}</td>
      <td>${escapeHtml(registro.usuario || 'Sistema')}</td>
      <td>${escapeHtml(registro.rol || '—')}</td>
      <td>${escapeHtml(registro.accion || '—')}</td>
      <td>${escapeHtml(registro.modulo || '—')}</td>
      <td>${escapeHtml(registro.registro_id ?? '—')}</td>
      <td title="${escapeHtml(formatearValor(detalle))}">${escapeHtml(descripcionDetalle)}</td>
      <td>
        <div class="acciones-registro" style="display:flex; flex-wrap:wrap; justify-content:flex-start;">
          <button type="button" class="boton-accion-card boton-secundario" data-accion="detalle" data-id="${registro.id}">Ver detalle</button>
          ${puedeModificarAuditoria() ? `<button type="button" class="boton-accion-card boton-secundario" data-accion="editar" data-id="${registro.id}">Modificar</button>` : ''}
          ${puedeModificarAuditoria() ? `<button type="button" class="boton-accion-card boton-eliminar" data-accion="eliminar" data-id="${registro.id}">Eliminar</button>` : ''}
        </div>
      </td>
    `;

    tablaAuditoria.appendChild(fila);
  });

  // Los botones se crean con innerHTML, así que sus eventos se conectan
  // después, buscándolos por su atributo data-accion.
  tablaAuditoria.querySelectorAll('[data-accion="detalle"]').forEach((boton) => {
    boton.addEventListener('click', () => abrirDetalleAuditoria(Number(boton.dataset.id)));
  });

  tablaAuditoria.querySelectorAll('[data-accion="editar"]').forEach((boton) => {
    boton.addEventListener('click', () => editarAuditoria(Number(boton.dataset.id)));
  });

  tablaAuditoria.querySelectorAll('[data-accion="eliminar"]').forEach((boton) => {
    boton.addEventListener('click', () => eliminarAuditoria(Number(boton.dataset.id)));
  });
}

// Descarga la página actual de eventos aplicando los filtros vigentes.
async function cargarAuditoria() {
  const query = construirQuery();
  try {
    const respuesta = await fetch(`/api/auditoria?${query}`, { cache: 'no-store' });
    if (!respuesta.ok) {
      const errorData = await respuesta.json().catch(() => ({}));
      throw new Error(errorData.mensaje || 'No se pudo cargar la auditoría.');
    }

    const datos = await respuesta.json();
    renderResumen(datos.resumen || {});
    renderTabla(datos.registros || []);
    renderPaginacion(datos.page || 1, datos.totalPages || 1);
  } catch (error) {
    console.error(error);
    vaciarTabla();
    mostrarAlertaError('No se pudo cargar la auditoría', error.message);
  }
}

// Ventana de detalle de un evento, con el comparativo "antes / después"
// que guardan las ediciones auditadas.
async function abrirDetalleAuditoria(id) {
  try {
    const respuesta = await fetch(`/api/auditoria/${id}`, { cache: 'no-store' });
    if (!respuesta.ok) throw new Error('No se pudo obtener el detalle.');
    const item = await respuesta.json();
    const detalle = convertirDetalle(item.detalle);
    const antes = detalle.antes || {};
    const despues = detalle.despues || detalle; // Si no hay "después", se muestra el detalle completo

    contenidoDetalle.innerHTML = `
      <div class="confirmacion-linea"><span>👤</span><div><small>Usuario</small><strong>${escapeHtml(item.usuario || 'Sistema')}</strong><em>${escapeHtml(item.rol || '—')}</em></div></div>
      <div class="confirmacion-linea"><span>🕒</span><div><small>Fecha</small><strong>${escapeHtml(formatearFecha(item.creado_en || item.fecha))}</strong><em>${escapeHtml(item.accion || '—')}</em></div></div>
      <div class="confirmacion-linea"><span>🧩</span><div><small>Módulo</small><strong>${escapeHtml(item.modulo || '—')}</strong><em>Registro #${escapeHtml(item.registro_id ?? '—')}</em></div></div>
      <div class="confirmacion-linea"><span>📝</span><div><small>Motivo</small><strong>${escapeHtml(detalle.motivo || 'Sin motivo registrado')}</strong><em>${escapeHtml(item.accion || '—')}</em></div></div>
      <div class="panel" style="grid-column:1 / -1; width:100%;">
        <h3>Antes</h3>
        <pre style="margin:0; white-space: pre-wrap; word-break: break-word; font-family: 'JetBrains Mono', monospace; font-size:11px; color:#c7cfcb;">${escapeHtml(formatearValor(antes))}</pre>
      </div>
      <div class="panel" style="grid-column:1 / -1; width:100%;">
        <h3>Después</h3>
        <pre style="margin:0; white-space: pre-wrap; word-break: break-word; font-family: 'JetBrains Mono', monospace; font-size:11px; color:#c7cfcb;">${escapeHtml(formatearValor(despues))}</pre>
      </div>
    `;
    modalDetalle.hidden = false; // Muestra la ventana
  } catch (error) {
    mostrarAlertaError('Detalle no disponible', error.message);
  }
}

// Modificar un evento (solo super admin): no cambia los datos originales,
// únicamente agrega/actualiza el motivo dentro del detalle. El cambio genera
// a su vez un nuevo evento EDITAR_AUDITORIA en la bitácora.
async function editarAuditoria(id) {
  const { value: motivo } = await Swal.fire({
    title: 'Modificar motivo del evento',
    input: 'text',
    inputLabel: 'Motivo',
    inputPlaceholder: 'Describe el motivo de la edición',
    showCancelButton: true,
    confirmButtonText: 'Guardar',
    cancelButtonText: 'Cancelar',
    preConfirm: (valor) => {
      const texto = String(valor || '').trim();
      if (!texto) {
        Swal.showValidationMessage('El motivo es obligatorio.');
        return false;
      }
      return texto;
    }
  });

  if (!motivo) return; // Cancelado

  try {
    const respuesta = await fetch(`/api/auditoria/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo, detalle: { motivo } })
    });

    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(data.mensaje || 'No se pudo actualizar el registro.');
    mostrarAlertaExito('Registro actualizado', 'El motivo del evento fue actualizado correctamente.');
    await cargarAuditoria();
  } catch (error) {
    mostrarAlertaError('No se pudo modificar', error.message);
  }
}

// Eliminar un evento de la bitácora (solo super admin). Es irreversible,
// aunque el backend deja constancia de la eliminación en un evento nuevo.
async function eliminarAuditoria(id) {
  const confirmado = await confirmarAccion('Eliminar registro de auditoría', 'Esta acción elimina el evento del historial y no se puede deshacer.', 'Sí, eliminar');
  if (!confirmado) return;

  try {
    const respuesta = await fetch(`/api/auditoria/${id}`, { method: 'DELETE' });
    const data = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(data.mensaje || 'No se pudo eliminar el evento.');
    mostrarAlertaExito('Evento eliminado', 'El registro de auditoría fue eliminado correctamente.');
    await cargarAuditoria();
  } catch (error) {
    mostrarAlertaError('No se pudo eliminar', error.message);
  }
}

// Vacía todos los filtros y vuelve a la primera página.
function limpiarFiltros() {
  Object.values(formFields).forEach((campo) => {
    if (campo && 'value' in campo) campo.value = '';
  });
  estadoAuditoria.page = 1;
  cargarAuditoria();
}

// Conecta todos los botones y campos de la pantalla.
function registrarEventos() {
  // Aplicar filtros: siempre se vuelve a la página 1.
  document.getElementById('boton-aplicar-filtros')?.addEventListener('click', () => {
    estadoAuditoria.page = 1;
    cargarAuditoria();
  });

  document.getElementById('boton-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
  // Exportar CSV: se navega al endpoint con los mismos filtros y el navegador
  // descarga el archivo. (Ver la nota sobre el orden de rutas en auditoria.routes.js.)
  document.getElementById('boton-exportar-auditoria')?.addEventListener('click', () => {
    const query = construirQuery();
    window.location.href = `/api/auditoria/export?${query}`;
  });

  // Paginación.
  document.getElementById('pagina-anterior')?.addEventListener('click', () => {
    if (estadoAuditoria.page > 1) {
      estadoAuditoria.page -= 1;
      cargarAuditoria();
    }
  });

  document.getElementById('pagina-siguiente')?.addEventListener('click', () => {
    if (estadoAuditoria.page < estadoAuditoria.totalPages) {
      estadoAuditoria.page += 1;
      cargarAuditoria();
    }
  });

  // Cierre de la ventana de detalle: con la × o haciendo clic fuera del cuadro.
  document.getElementById('cerrar-detalle-auditoria')?.addEventListener('click', () => {
    modalDetalle.hidden = true;
  });

  modalDetalle?.addEventListener('click', (evento) => {
    if (evento.target === modalDetalle) modalDetalle.hidden = true; // Solo si se pulsó el fondo
  });

  // La búsqueda libre recarga sola al escribir; los demás filtros esperan al
  // botón "Aplicar filtros".
  Object.entries(formFields).forEach(([key, field]) => {
    if (!field) return;
    const disparar = ['change', 'input'];
    disparar.forEach((tipo) => {
      field.addEventListener(tipo, () => {
        if (key === 'busqueda') {
          estadoAuditoria.page = 1;
          cargarAuditoria();
        }
      });
    });
  });
}

registrarEventos();
cargarAuditoria(); // Primera carga
