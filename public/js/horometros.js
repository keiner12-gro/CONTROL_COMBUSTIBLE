// ============================================================================
// horometros.js — VISTA "HORÓMETROS POR MÁQUINA" (public/html/horometros.html)
// ----------------------------------------------------------------------------
// Una carta por máquina (todas las que tanquearon en el rango, sin excepción)
// con: tanqueos, galones, promedio por tanqueo, horómetro inicial y final,
// horas trabajadas y galones por hora. "Ver tanqueos" despliega cada tanqueo
// dentro de la misma carta, con cada dato rotulado.
// Los cálculos los hace el SERVIDOR (GET /api/horometros, regla de 24 h por
// día en src/records/domain/horometro.js): aquí solo se muestran y filtran.
// ============================================================================

const campoDesde = document.getElementById('horometros-desde');
const campoHasta = document.getElementById('horometros-hasta');
const campoBuscar = document.getElementById('horometros-buscar');
const campoEstado = document.getElementById('horometros-estado');
const contenedorTarjetas = document.getElementById('horometros-tarjetas');
const mensajeVacio = document.getElementById('horometros-vacio');
const totalMaquinas = document.getElementById('horometros-total-maquinas');
const totalTanqueos = document.getElementById('horometros-total-tanqueos');

let maquinasPeriodo = []; // Lo que devolvió el servidor para el rango de fechas
let maquinasVisibles = []; // Lo que se ve tras filtrar (también es lo que se exporta)
const maquinasAbiertas = new Set(); // Cartas con los tanqueos desplegados

const ESTADOS = {
  ok: { texto: '✓ OK', clase: 'ok' },
  ajustado: { texto: '⚠ Tramos ajustados', clase: 'ajustado' },
  'sin-lecturas': { texto: 'Sin lecturas numéricas', clase: 'neutro' },
  'una-lectura': { texto: 'Una sola lectura', clase: 'neutro' },
  'sin-horometro': { texto: 'Sin horómetro (N/A)', clase: 'neutro' },
  tanque: { texto: 'Tanque móvil (N/A)', clase: 'neutro' }
};

// --- Formatos ----------------------------------------------------------------
const numero = (n, decimales = 2) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : Number(n).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const fechaCorta = (fecha) => String(fecha || '').slice(0, 10).split('-').reverse().join('/');
// Fecha local de hoy en YYYY-MM-DD (no UTC, para que no salte de día de noche).
function hoyLocalTexto() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

// --- Datos ---------------------------------------------------------------------
async function cargarHorometros() {
  const parametros = new URLSearchParams({ fechaInicio: campoDesde.value, fechaFin: campoHasta.value });
  try {
    const respuesta = await fetch(`/api/horometros?${parametros}`, { cache: 'no-store' });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo cargar el reporte de horómetros.');
    maquinasPeriodo = Array.isArray(datos) ? datos : [];
    pintarTarjetas();
  } catch (error) {
    maquinasPeriodo = [];
    pintarTarjetas();
    mostrarAlertaError('No se pudo cargar', error.message);
  }
}

// Primero la maquinaria con horómetro (de mayor a menor consumo, como llega
// del servidor) y al final el tanque móvil y las máquinas sin horómetro.
const SIN_HOROMETRO = ['tanque', 'sin-horometro'];
const ordenVista = (m) => (SIN_HOROMETRO.includes(m.estado) ? 1 : 0);

function filtrarMaquinas() {
  const texto = campoBuscar.value.trim().toLowerCase();
  const estado = campoEstado.value;
  return [...maquinasPeriodo].sort((a, b) => ordenVista(a) - ordenVista(b)).filter((m) => {
    const coincideTexto = !texto || m.maquina.toLowerCase().includes(texto) || String(m.descripcion || '').toLowerCase().includes(texto);
    const coincideEstado =
      !estado ||
      (estado === 'sin-datos' && ['sin-lecturas', 'una-lectura'].includes(m.estado)) ||
      (estado === 'na' && ['sin-horometro', 'tanque'].includes(m.estado)) ||
      m.estado === estado;
    return coincideTexto && coincideEstado;
  });
}

// --- Cartas ----------------------------------------------------------------------
// Un dato rotulado de la carta (mismo estilo que los campos de Historial).
function dato(etiqueta, valor, destacado = false) {
  return `<div class="campo-registro-tarjeta${destacado ? ' dato-destacado' : ''}"><span>${escapeHtml(etiqueta)}</span><strong>${escapeHtml(valor)}</strong></div>`;
}

// Explica por qué un tramo se ajustó (o vacío si no se ajustó).
function motivoAjuste(t) {
  if (t.retrocede) return `El horómetro bajó (${numero(t.horasHorometro, 1)} h): se cuentan 0 h`;
  if (t.ajustado) return `El horómetro marcó ${numero(t.horasHorometro, 1)} h, pero en ese tiempo solo caben ${numero(t.topeHoras, 0)} h (24 h por día)`;
  return '';
}

// Cada tanqueo es un bloque pequeño con todos sus datos rotulados.
function htmlTanqueo(t, indice) {
  const motivo = motivoAjuste(t);
  const horas = t.horasTramo === null ? (indice === 0 ? 'Primera lectura' : '—') : `${numero(t.horasTramo, 1)} h`;
  return `
    <li class="tanqueo-item${motivo ? ' tanqueo-ajustado' : ''}">
      <div class="tanqueo-cabecera"><strong>📅 ${escapeHtml(fechaCorta(t.fecha))}</strong><span>👤 ${escapeHtml(t.operario || '—')}</span></div>
      <div class="tanqueo-datos">
        ${dato('Horómetro', t.horometro || '—')}
        ${dato('Galones', numero(t.cantidad))}
        ${dato('Horas trabajadas', horas)}
        ${dato('Gal/hora', numero(t.galonesPorHoraTramo))}
      </div>
      ${motivo ? `<p class="tanqueo-motivo">⚠ ${escapeHtml(motivo)}</p>` : ''}
      ${t.observaciones ? `<p class="tanqueo-observacion">💬 ${escapeHtml(t.observaciones)}</p>` : ''}
    </li>`;
}

function crearTarjeta(m) {
  const estado = ESTADOS[m.estado] || ESTADOS.ok;
  const avisos = (m.tramosAjustados || 0) + (m.tramosQueRetroceden || 0);
  const textoEstado = m.estado === 'ajustado' ? `⚠ ${avisos} tramo(s) ajustado(s) a 24 h por día` : estado.texto;
  const abierta = maquinasAbiertas.has(m.maquina);
  const tarjeta = document.createElement('article');
  tarjeta.className = `registro-tarjeta tarjeta-horometro estado-${estado.clase}`;
  tarjeta.innerHTML = `
    <div class="registro-tarjeta-cabecera">
      <div>
        <span class="badge-registro-fecha">${escapeHtml(m.tipo || 'Sin tipo')}</span>
        <h3>${escapeHtml(m.maquina)}</h3>
        <p>${escapeHtml(m.descripcion || 'Sin descripción')}</p>
      </div>
      <div class="registro-cantidad"><strong>${numero(m.galonesPorHora)}</strong><span>GAL/HORA</span></div>
    </div>
    <div class="grid-campos-registro">
      ${dato('Tanqueos', String(m.cantidadTanqueos))}
      ${dato('Galones', numero(m.galones))}
      ${dato('Promedio por tanqueo', numero(m.promedio))}
      ${dato('Horas trabajadas', m.horasTrabajadas === null ? '—' : `${numero(m.horasTrabajadas, 1)} h`, true)}
      ${dato('Horómetro inicial', numero(m.horometroInicial, 1))}
      ${dato('Horómetro final', numero(m.horometroFinal, 1))}
    </div>
    <div class="registro-soporte estado-horometro-${estado.clase}"><span>Estado</span><strong>${escapeHtml(textoEstado)}</strong></div>
    <div class="acciones-tarjeta-registro"><button type="button" class="boton-secundario" aria-expanded="${abierta}">${abierta ? '▾ Ocultar tanqueos' : `▸ Ver tanqueos (${m.cantidadTanqueos})`}</button></div>
    <ol class="lista-tanqueos" ${abierta ? '' : 'hidden'}>${m.tanqueos.map(htmlTanqueo).join('')}</ol>`;

  const boton = tarjeta.querySelector('.acciones-tarjeta-registro button');
  const lista = tarjeta.querySelector('.lista-tanqueos');
  boton.addEventListener('click', () => {
    lista.hidden = !lista.hidden;
    if (lista.hidden) maquinasAbiertas.delete(m.maquina);
    else maquinasAbiertas.add(m.maquina);
    boton.setAttribute('aria-expanded', String(!lista.hidden));
    boton.textContent = lista.hidden ? `▸ Ver tanqueos (${m.cantidadTanqueos})` : '▾ Ocultar tanqueos';
  });
  return tarjeta;
}

function pintarTarjetas() {
  maquinasVisibles = filtrarMaquinas();
  contenedorTarjetas.innerHTML = '';
  maquinasVisibles.forEach((m) => contenedorTarjetas.appendChild(crearTarjeta(m)));
  mensajeVacio.hidden = maquinasVisibles.length > 0;
  totalMaquinas.textContent = String(maquinasVisibles.length);
  totalTanqueos.textContent = String(maquinasVisibles.reduce((t, m) => t + m.cantidadTanqueos, 0));
}

// --- Excel: una fila por tanqueo con los totales de su máquina -------------------
function exportarExcel() {
  const celda = (v) => `<td>${escapeHtml(v === null || v === undefined ? '' : String(v))}</td>`;
  const num = (n, d = 2) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : Number(n).toFixed(d));
  const filas = maquinasVisibles
    .flatMap((m) =>
      m.tanqueos.map(
        (t) =>
          `<tr>${[
            m.maquina, m.tipo, fechaCorta(t.fecha), t.operario, t.horometro, num(t.cantidad),
            num(t.horasHorometro, 1), num(t.horasTramo, 1), motivoAjuste(t), num(t.galonesPorHoraTramo), t.observaciones,
            m.cantidadTanqueos, num(m.galones), num(m.promedio), num(m.horometroInicial, 1), num(m.horometroFinal, 1),
            num(m.horasTrabajadas, 1), num(m.galonesPorHora), (ESTADOS[m.estado] || ESTADOS.ok).texto
          ].map(celda).join('')}</tr>`
      )
    )
    .join('');
  const encabezados = ['Máquina', 'Tipo', 'Fecha', 'Operario', 'Horómetro', 'Galones', 'Horas según horómetro', 'Horas trabajadas (máx. 24 h/día)', 'Ajuste', 'Gal/hora del tramo', 'Observaciones',
    'Tanqueos (máquina)', 'Galones (máquina)', 'Promedio por tanqueo', 'Horómetro inicial', 'Horómetro final', 'Horas trabajadas (máquina)', 'Gal/hora (máquina)', 'Estado'];
  const html = `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${encabezados.map((e) => `<th>${e}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></body></html>`;
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
  enlace.download = `horometros-${campoDesde.value}-a-${campoHasta.value}.xls`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

// --- Eventos y carga inicial: del 1 de enero del año actual hasta hoy -------------
const hoy = hoyLocalTexto();
campoDesde.value = `${hoy.slice(0, 4)}-01-01`;
campoHasta.value = hoy;
campoDesde.addEventListener('change', cargarHorometros);
campoHasta.addEventListener('change', cargarHorometros);
campoBuscar.addEventListener('input', pintarTarjetas);
campoEstado.addEventListener('change', pintarTarjetas);
document.getElementById('horometros-exportar').addEventListener('click', exportarExcel);
cargarHorometros();
