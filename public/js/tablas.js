// ============================================================================
// tablas.js — PANTALLA "HISTORIAL" (public/html/tablas.html)
// ----------------------------------------------------------------------------
// Muestra los registros de suministro como tarjetas editables, con buscador por
// texto y por fecha, y exportación a Excel/PDF.
// Funcionamiento: se descargan los registros del servidor, se guardan en
// localStorage como copia local y se pintan desde ahí. Si el servidor no
// responde, se sigue mostrando la última copia descargada.
// NOTA: este archivo está escrito en formato compacto (una función por línea);
// los comentarios de arriba de cada línea explican qué hace cada una.
// ============================================================================

// --- Referencias a los elementos de la pantalla y estado local --------------
const nombreAlmacenamiento='registrosCombustible'; // Clave en localStorage donde se guarda la copia
const buscarRegistro=document.getElementById('buscar-registro'); // Caja de búsqueda por texto
const buscarFecha=document.getElementById('buscar-fecha'); // Filtro por fecha
const botonLimpiarBusqueda=document.getElementById('boton-limpiar-busqueda'); // Borra los filtros
const botonExportarExcel=document.getElementById('boton-exportar-excel');
const botonExportarPdf=document.getElementById('boton-exportar-pdf');
const cuerpoRegistrosTarjetas=document.getElementById('cuerpo-registros-tarjetas'); // Contenedor de tarjetas
const cantidadRegistros=document.getElementById('cantidad-registros'); // Contador de resultados
const mensajeTablaVacia=document.getElementById('mensaje-tabla-vacia'); // Aviso "sin resultados"
const resumenTablaGeneral=document.getElementById('resumen-tabla-general'); // Suma de galones mostrados
let registrosFiltrados=[]; // Lo que se está viendo ahora (también es lo que se exporta)

// Lee la copia local de registros (devuelve [] si no hay nada o está dañada).
function obtenerRegistrosGuardados(){return JSON.parse(localStorage.getItem(nombreAlmacenamiento))||[];}
// Reemplaza la copia local completa.
function guardarRegistrosLocales(registros){localStorage.setItem(nombreAlmacenamiento,JSON.stringify(registros));}
// Descarga los registros frescos del servidor (sin caché).
async function obtenerRegistrosServidor(){const respuesta=await fetch('/api/registros',{cache:'no-store'});if(!respuesta.ok)throw new Error('No se pudieron cargar los registros del servidor.');return respuesta.json();}
// Convierte 2026-03-15 en 15/03/2026 para mostrarlo.
function formatearFechaTabla(fecha){const s=String(fecha||'');return s.includes('-')?s.split('-').reverse().join('/') : s;}
// Aplica los filtros: descarta los cierres de día y busca por fecha exacta y
// por texto en operario, máquina o cédula. "indiceOriginal" se conserva para
// poder editar la posición correcta dentro de la copia local.
function obtenerRegistrosFiltrados(){const texto=buscarRegistro.value.trim().toLowerCase();const fecha=buscarFecha.value;return obtenerRegistrosGuardados().map((registro,indiceOriginal)=>({...registro,indiceOriginal})).filter(r=>{if(r.cierreDia===true||Number(r.cierreDia)===1)return false;const coincideFecha=!fecha||String(r.fecha||'').slice(0,10)===fecha;const coincideTexto=!texto||String(r.operario||'').toLowerCase().includes(texto)||String(r.maquina||'').toLowerCase().includes(texto)||String(r.cedula||'').toLowerCase().includes(texto);return coincideFecha&&coincideTexto;});}
// Aplica los cambios sobre la copia local (para que la pantalla reaccione ya).
function actualizarRegistroLocal(indice,cambios){const registros=obtenerRegistrosGuardados();if(!registros[indice])return;Object.assign(registros[indice],cambios);guardarRegistrosLocales(registros);}
// Envía la edición al servidor (PUT /api/registros/:id). Si el registro no
// tiene id, es un dato solo local y se actualiza únicamente en el navegador.
async function actualizarRegistroServidor(registro,cambios){if(!registro.id){actualizarRegistroLocal(registro.indiceOriginal,cambios);return;}const r=await fetch(`/api/registros/${registro.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cambios)});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.mensaje||'No se pudo actualizar el registro.');}}
// Crea un campo de la tarjeta. Nace deshabilitado: solo se activa al pulsar
// "Editar". data-campo guarda el nombre que espera la API.
function campoTarjeta(label,campo,valor,tipo='text'){const wrapper=document.createElement('label');wrapper.className='campo-registro-tarjeta';wrapper.innerHTML=`<span>${label}</span>`;const input=document.createElement('input');input.type=tipo;input.value=valor??'';input.dataset.campo=campo;input.disabled=true;if(tipo==='number'){input.step='0.01';input.min='0';}wrapper.appendChild(input);return wrapper;}

// Construye una tarjeta completa de registro: cabecera, campos, firma y botones.
function crearTarjeta(registro){
 const card=document.createElement('article');card.className='registro-tarjeta';card.dataset.id=registro.id||'';
 // Cabecera: fecha, máquina, operario/cédula y la cantidad destacada a la derecha.
 const cab=document.createElement('div');cab.className='registro-tarjeta-cabecera';cab.innerHTML=`<div><span class="badge-registro-fecha">${escapeHtml(formatearFechaTabla(registro.fecha))}</span><h3>${escapeHtml(registro.maquina||'Máquina no registrada')}</h3><p>${escapeHtml(registro.operario||'Operario no registrado')} · C.C. ${escapeHtml(registro.cedula||'—')}</p></div><div class="registro-cantidad"><strong>${Number(registro.cantidad||0).toFixed(2)}</strong><span>GAL</span></div>`;card.appendChild(cab);
 // Rejilla con los campos editables. SON LOS MISMOS SIETE QUE ACEPTA LA API
 // (ver la lista blanca en mysql-record.repository.js -> update).
 const grid=document.createElement('div');grid.className='grid-campos-registro';
 grid.appendChild(campoTarjeta('Máquina','maquina',registro.maquina));grid.appendChild(campoTarjeta('Operario','operario',registro.operario));grid.appendChild(campoTarjeta('Cédula','cedula',registro.cedula));grid.appendChild(campoTarjeta('Horómetro','horometro',registro.horometro));grid.appendChild(campoTarjeta('Cantidad (GAL)','cantidad',registro.cantidad,'number'));grid.appendChild(campoTarjeta('No. SAI','numeroSai',registro.numeroSai));
 const obs=campoTarjeta('Observaciones','observaciones',registro.observaciones);grid.appendChild(obs);card.appendChild(grid);
 // Indicador de firma (la firma en sí no se edita desde aquí).
 const soporte=document.createElement('div');soporte.className='registro-soporte';soporte.innerHTML=`<span>Firma</span><strong>${registro.firma?'✓ Firma registrada':'— Sin firma'}</strong>`;card.appendChild(soporte);
 // Botonera: Editar / Guardar (oculto al inicio) / Eliminar.
 const acciones=document.createElement('div');acciones.className='acciones-tarjeta-registro';
 const editar=document.createElement('button');editar.type='button';editar.className='boton-secundario';editar.textContent='✏ Editar';
 const guardar=document.createElement('button');guardar.type='button';guardar.className='boton-principal';guardar.textContent='✓ Guardar';guardar.hidden=true;
 const eliminar=document.createElement('button');eliminar.type='button';eliminar.className='boton-eliminar';eliminar.textContent='Eliminar';
 const inputs=[...grid.querySelectorAll('input')];
 // "Editar": habilita los campos, cambia los botones y pone el cursor en el primero.
 editar.onclick=()=>{inputs.forEach(i=>i.disabled=false);editar.hidden=true;guardar.hidden=false;inputs[0]?.focus();};
 // "Guardar": arma el objeto de cambios leyendo cada data-campo, lo envía al
 // servidor, actualiza la copia local y recarga el listado.
 guardar.onclick=async()=>{const cambios={};inputs.forEach(i=>cambios[i.dataset.campo]=i.value);guardar.disabled=true;try{await actualizarRegistroServidor(registro,cambios);actualizarRegistroLocal(registro.indiceOriginal,cambios);await mostrarAlertaExito('Registro actualizado','Los cambios fueron guardados correctamente.');await cargarRegistros();}catch(e){guardar.disabled=false;await mostrarAlertaError('No se pudo guardar',e.message);}};
 // "Eliminar": en realidad ANULA. Pide motivo obligatorio, llama al DELETE de
 // la API (que solo marca el registro como ANULADO) y lo quita de la vista.
 eliminar.onclick=async()=>{const motivo=await solicitarMotivoAnulacion('Anular registro','El registro no se borrará: quedará anulado y disponible en auditoría, y dejará de aparecer en el historial.');if(!motivo)return;try{if(registro.id){const r=await fetch(`/api/registros/${registro.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({motivo})});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.mensaje||'No se pudo anular el registro.');}}const registros=obtenerRegistrosGuardados();registros.splice(registro.indiceOriginal,1);guardarRegistrosLocales(registros);await cargarRegistros();await mostrarAlertaExito('Registro anulado','El suministro fue anulado y quedó fuera del historial.');}catch(e){await mostrarAlertaError('No se pudo anular',e.message);}};
 acciones.append(editar,guardar,eliminar);card.appendChild(acciones);return card;
}

// Descarga del servidor y repinta. El catch vacío es intencional: si no hay
// red, se pinta con la última copia guardada en el navegador.
async function cargarRegistros(){try{guardarRegistrosLocales(await obtenerRegistrosServidor());}catch(_){ }pintarTarjetas();}
// Vacía el contenedor, aplica filtros, actualiza contador y total, y dibuja.
function pintarTarjetas(){cuerpoRegistrosTarjetas.innerHTML='';registrosFiltrados=obtenerRegistrosFiltrados();cantidadRegistros.textContent=registrosFiltrados.length;resumenTablaGeneral.textContent=registrosFiltrados.reduce((t,r)=>t+(Number(r.cantidad)||0),0).toFixed(2);mensajeTablaVacia.hidden=registrosFiltrados.length>0;registrosFiltrados.forEach(r=>cuerpoRegistrosTarjetas.appendChild(crearTarjeta(r)));}
// Genera un archivo en memoria y dispara la descarga con un enlace temporal.
function descargarArchivo(nombre,contenido,tipo){const blob=new Blob([contenido],{type:tipo});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nombre;a.click();URL.revokeObjectURL(a.href);}
// Escapa caracteres especiales para que no rompan el HTML que lee Excel.
function limpiarTextoExcel(texto){return String(texto||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
// Exporta a Excel: se arma una tabla HTML y se guarda con extensión .xls,
// que Excel abre sin problema. Solo se exporta lo que está filtrado en pantalla.
function exportarExcel(){const filas=registrosFiltrados.map(r=>`<tr><td>${limpiarTextoExcel(formatearFechaTabla(r.fecha))}</td><td>${limpiarTextoExcel(r.operario)}</td><td>${limpiarTextoExcel(r.cedula)}</td><td>${limpiarTextoExcel(r.maquina)}</td><td>${limpiarTextoExcel(r.horometro)}</td><td>${limpiarTextoExcel(r.cantidad)}</td><td>${limpiarTextoExcel(r.numeroSai)}</td><td>${r.firma?'Con firma':'Sin firma'}</td><td>${limpiarTextoExcel(r.observaciones)}</td></tr>`).join('');const tabla=`<table><thead><tr><th>Fecha</th><th>Operario</th><th>Cedula</th><th>Maquina</th><th>Horometro</th><th>Cantidad</th><th>No. SAI</th><th>Firma</th><th>Observaciones</th></tr></thead><tbody>${filas}</tbody></table>`;descargarArchivo(`registros-combustible-${buscarFecha.value||'todos'}.xls`,tabla,'application/vnd.ms-excel');}
// "Exportar PDF" usa la impresión del navegador (Guardar como PDF); los
// estilos @media print de styles.css controlan qué se imprime.
function exportarPdf(){window.print();}

// --- Eventos de la pantalla y carga inicial ---------------------------------
// Los dos buscadores repintan al escribir, limpiar resetea los filtros, y al
// final se hace la primera carga de datos.
buscarRegistro.addEventListener('input',pintarTarjetas);buscarFecha.addEventListener('input',pintarTarjetas);botonLimpiarBusqueda.addEventListener('click',()=>{buscarRegistro.value='';buscarFecha.value='';pintarTarjetas();});botonExportarExcel.addEventListener('click',exportarExcel);botonExportarPdf.addEventListener('click',exportarPdf);cargarRegistros();
