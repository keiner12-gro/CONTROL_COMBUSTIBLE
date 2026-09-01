const estadoAuditoria = {
  page: 1,
  limit: 20,
  totalPages: 1,
  filtros: {}
};

const modalDetalle = document.getElementById('detalle-auditoria-modal');
const contenidoDetalle = document.getElementById('detalle-auditoria-contenido');
const tablaAuditoria = document.getElementById('tabla-auditoria');
const cantidadAuditoria = document.getElementById('cantidad-auditoria');
const rangoRegistros = document.getElementById('rango-registros');
const paginaActual = document.getElementById('pagina-actual');
const totalEventos = document.getElementById('total-eventos');
const usuariosUnicos = document.getElementById('usuarios-unicos');
const accionesUnicas = document.getElementById('acciones-unicas');
const modulosUnicos = document.getElementById('modulos-unicos');

const formFields = {
  desde: document.getElementById('filtro-fecha-desde'),
  hasta: document.getElementById('filtro-fecha-hasta'),
  usuario: document.getElementById('filtro-usuario'),
  accion: document.getElementById('filtro-accion'),
  modulo: document.getElementById('filtro-modulo'),
  busqueda: document.getElementById('filtro-busqueda')
};

function puedeModificarAuditoria() {
  const sesion = obtenerSesionActual();
  return String(sesion?.rol || '').toLowerCase() === 'super_administrador';
}

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

  if (filtroDesde) params.set('fechaDesde', filtroDesde);
  if (filtroHasta) params.set('fechaHasta', filtroHasta);
  if (filtroUsuario) params.set('usuario', filtroUsuario);
  if (filtroAccion) params.set('accion', filtroAccion);
  if (filtroModulo) params.set('modulo', filtroModulo);
  if (filtroBusqueda) params.set('q', filtroBusqueda);

  return params.toString();
}

function vaciarTabla() {
  tablaAuditoria.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="estado-vacio-selector">No hay eventos que coincidan con los filtros seleccionados.</div>
      </td>
    </tr>
  `;
}

function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'object') return JSON.stringify(valor, null, 2);
  return String(valor);
}

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

function renderResumen(resumen = {}) {
  totalEventos.textContent = Number(resumen.total_eventos || 0);
  usuariosUnicos.textContent = Number(resumen.usuarios_unicos || 0);
  accionesUnicas.textContent = Number(resumen.acciones_unicas || 0);
  modulosUnicos.textContent = Number(resumen.modulos_unicos || 0);
}

function renderPaginacion(page, totalPages) {
  estadoAuditoria.page = Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(totalPages) || 1));
  estadoAuditoria.totalPages = Math.max(1, Number(totalPages) || 1);
  paginaActual.textContent = `Página ${estadoAuditoria.page}`;
  const anterior = document.getElementById('pagina-anterior');
  const siguiente = document.getElementById('pagina-siguiente');
  anterior.disabled = estadoAuditoria.page <= 1;
  siguiente.disabled = estadoAuditoria.page >= estadoAuditoria.totalPages;
}

function convertirDetalle(detalle) {
  if (!detalle || typeof detalle !== 'object') return {};
  if (Array.isArray(detalle)) return { valores: detalle };
  return detalle;
}

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

    const descripcionDetalle = (() => {
      const keys = Object.keys(detalle);
      if (!keys.length) return 'Sin detalle';
      const primer = detailValue => {
        if (typeof detailValue === 'object') return JSON.stringify(detailValue).slice(0, 90);
        return String(detailValue).slice(0, 90);
      };
      return primer(detalle[keys[0]]);
    })();

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

async function abrirDetalleAuditoria(id) {
  try {
    const respuesta = await fetch(`/api/auditoria/${id}`, { cache: 'no-store' });
    if (!respuesta.ok) throw new Error('No se pudo obtener el detalle.');
    const item = await respuesta.json();
    const detalle = convertirDetalle(item.detalle);
    const antes = detalle.antes || {};
    const despues = detalle.despues || detalle;

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
    modalDetalle.hidden = false;
  } catch (error) {
    mostrarAlertaError('Detalle no disponible', error.message);
  }
}

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

  if (!motivo) return;

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

function limpiarFiltros() {
  Object.values(formFields).forEach((campo) => {
    if (campo && 'value' in campo) campo.value = '';
  });
  estadoAuditoria.page = 1;
  cargarAuditoria();
}

function registrarEventos() {
  document.getElementById('boton-aplicar-filtros')?.addEventListener('click', () => {
    estadoAuditoria.page = 1;
    cargarAuditoria();
  });

  document.getElementById('boton-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
  document.getElementById('boton-exportar-auditoria')?.addEventListener('click', () => {
    const query = construirQuery();
    window.location.href = `/api/auditoria/export?${query}`;
  });

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

  document.getElementById('cerrar-detalle-auditoria')?.addEventListener('click', () => {
    modalDetalle.hidden = true;
  });

  modalDetalle?.addEventListener('click', (evento) => {
    if (evento.target === modalDetalle) modalDetalle.hidden = true;
  });

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
cargarAuditoria();
