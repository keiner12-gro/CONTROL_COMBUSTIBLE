const nombreAlmacenamiento='registrosCombustible';
const buscarRegistro=document.getElementById('buscar-registro');
const buscarFecha=document.getElementById('buscar-fecha');
const botonLimpiarBusqueda=document.getElementById('boton-limpiar-busqueda');
const botonExportarExcel=document.getElementById('boton-exportar-excel');
const botonExportarPdf=document.getElementById('boton-exportar-pdf');
const cuerpoRegistrosTarjetas=document.getElementById('cuerpo-registros-tarjetas');
const cantidadRegistros=document.getElementById('cantidad-registros');
const mensajeTablaVacia=document.getElementById('mensaje-tabla-vacia');
const resumenTablaGeneral=document.getElementById('resumen-tabla-general');
let registrosFiltrados=[];

function obtenerRegistrosGuardados(){return JSON.parse(localStorage.getItem(nombreAlmacenamiento))||[];}
function guardarRegistrosLocales(registros){localStorage.setItem(nombreAlmacenamiento,JSON.stringify(registros));}
async function obtenerRegistrosServidor(){const respuesta=await fetch('/api/registros',{cache:'no-store'});if(!respuesta.ok)throw new Error('No se pudieron cargar los registros del servidor.');return respuesta.json();}
function formatearFechaTabla(fecha){const s=String(fecha||'');return s.includes('-')?s.split('-').reverse().join('/') : s;}
function obtenerRegistrosFiltrados(){const texto=buscarRegistro.value.trim().toLowerCase();const fecha=buscarFecha.value;return obtenerRegistrosGuardados().map((registro,indiceOriginal)=>({...registro,indiceOriginal})).filter(r=>{if(r.cierreDia===true||Number(r.cierreDia)===1)return false;const coincideFecha=!fecha||String(r.fecha||'').slice(0,10)===fecha;const coincideTexto=!texto||String(r.operario||'').toLowerCase().includes(texto)||String(r.maquina||'').toLowerCase().includes(texto)||String(r.cedula||'').toLowerCase().includes(texto);return coincideFecha&&coincideTexto;});}
function actualizarRegistroLocal(indice,cambios){const registros=obtenerRegistrosGuardados();if(!registros[indice])return;Object.assign(registros[indice],cambios);guardarRegistrosLocales(registros);}
async function actualizarRegistroServidor(registro,cambios){if(!registro.id){actualizarRegistroLocal(registro.indiceOriginal,cambios);return;}const r=await fetch(`/api/registros/${registro.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(cambios)});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.mensaje||'No se pudo actualizar el registro.');}}
function campoTarjeta(label,campo,valor,tipo='text'){const wrapper=document.createElement('label');wrapper.className='campo-registro-tarjeta';wrapper.innerHTML=`<span>${label}</span>`;const input=document.createElement('input');input.type=tipo;input.value=valor??'';input.dataset.campo=campo;input.disabled=true;if(tipo==='number'){input.step='0.01';input.min='0';}wrapper.appendChild(input);return wrapper;}
function crearTarjeta(registro){
 const card=document.createElement('article');card.className='registro-tarjeta';card.dataset.id=registro.id||'';
 const cab=document.createElement('div');cab.className='registro-tarjeta-cabecera';cab.innerHTML=`<div><span class="badge-registro-fecha">${escapeHtml(formatearFechaTabla(registro.fecha))}</span><h3>${escapeHtml(registro.maquina||'Máquina no registrada')}</h3><p>${escapeHtml(registro.operario||'Operario no registrado')} · C.C. ${escapeHtml(registro.cedula||'—')}</p></div><div class="registro-cantidad"><strong>${Number(registro.cantidad||0).toFixed(2)}</strong><span>GAL</span></div>`;card.appendChild(cab);
 const grid=document.createElement('div');grid.className='grid-campos-registro';
 grid.appendChild(campoTarjeta('Máquina','maquina',registro.maquina));grid.appendChild(campoTarjeta('Operario','operario',registro.operario));grid.appendChild(campoTarjeta('Cédula','cedula',registro.cedula));grid.appendChild(campoTarjeta('Horómetro','horometro',registro.horometro));grid.appendChild(campoTarjeta('Cantidad (GAL)','cantidad',registro.cantidad,'number'));grid.appendChild(campoTarjeta('No. SAI','numeroSai',registro.numeroSai));
 const obs=campoTarjeta('Observaciones','observaciones',registro.observaciones);grid.appendChild(obs);card.appendChild(grid);
 const soporte=document.createElement('div');soporte.className='registro-soporte';soporte.innerHTML=`<span>Firma</span><strong>${registro.firma?'✓ Firma registrada':'— Sin firma'}</strong>`;card.appendChild(soporte);
 const acciones=document.createElement('div');acciones.className='acciones-tarjeta-registro';
 const editar=document.createElement('button');editar.type='button';editar.className='boton-secundario';editar.textContent='✏ Editar';
 const guardar=document.createElement('button');guardar.type='button';guardar.className='boton-principal';guardar.textContent='✓ Guardar';guardar.hidden=true;
 const eliminar=document.createElement('button');eliminar.type='button';eliminar.className='boton-eliminar';eliminar.textContent='Eliminar';
 const inputs=[...grid.querySelectorAll('input')];
 editar.onclick=()=>{inputs.forEach(i=>i.disabled=false);editar.hidden=true;guardar.hidden=false;inputs[0]?.focus();};
 guardar.onclick=async()=>{const cambios={};inputs.forEach(i=>cambios[i.dataset.campo]=i.value);guardar.disabled=true;try{await actualizarRegistroServidor(registro,cambios);actualizarRegistroLocal(registro.indiceOriginal,cambios);await mostrarAlertaExito('Registro actualizado','Los cambios fueron guardados correctamente.');await cargarRegistros();}catch(e){guardar.disabled=false;await mostrarAlertaError('No se pudo guardar',e.message);}};
 eliminar.onclick=async()=>{const ok=await confirmarAccion('Eliminar registro','Esta acción eliminará el suministro del historial.','Sí, eliminar');if(!ok)return;try{if(registro.id){const r=await fetch(`/api/registros/${registro.id}`,{method:'DELETE'});if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.mensaje||'No se pudo eliminar el registro.');}}const registros=obtenerRegistrosGuardados();registros.splice(registro.indiceOriginal,1);guardarRegistrosLocales(registros);await cargarRegistros();await mostrarAlertaExito('Registro eliminado','El suministro fue eliminado del historial.');}catch(e){await mostrarAlertaError('No se pudo eliminar',e.message);}};
 acciones.append(editar,guardar,eliminar);card.appendChild(acciones);return card;
}
async function cargarRegistros(){try{guardarRegistrosLocales(await obtenerRegistrosServidor());}catch(_){ }pintarTarjetas();}
function pintarTarjetas(){cuerpoRegistrosTarjetas.innerHTML='';registrosFiltrados=obtenerRegistrosFiltrados();cantidadRegistros.textContent=registrosFiltrados.length;resumenTablaGeneral.textContent=registrosFiltrados.reduce((t,r)=>t+(Number(r.cantidad)||0),0).toFixed(2);mensajeTablaVacia.hidden=registrosFiltrados.length>0;registrosFiltrados.forEach(r=>cuerpoRegistrosTarjetas.appendChild(crearTarjeta(r)));}
function descargarArchivo(nombre,contenido,tipo){const blob=new Blob([contenido],{type:tipo});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=nombre;a.click();URL.revokeObjectURL(a.href);}
function limpiarTextoExcel(texto){return String(texto||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function exportarExcel(){const filas=registrosFiltrados.map(r=>`<tr><td>${limpiarTextoExcel(formatearFechaTabla(r.fecha))}</td><td>${limpiarTextoExcel(r.operario)}</td><td>${limpiarTextoExcel(r.cedula)}</td><td>${limpiarTextoExcel(r.maquina)}</td><td>${limpiarTextoExcel(r.horometro)}</td><td>${limpiarTextoExcel(r.cantidad)}</td><td>${limpiarTextoExcel(r.numeroSai)}</td><td>${r.firma?'Con firma':'Sin firma'}</td><td>${limpiarTextoExcel(r.observaciones)}</td></tr>`).join('');const tabla=`<table><thead><tr><th>Fecha</th><th>Operario</th><th>Cedula</th><th>Maquina</th><th>Horometro</th><th>Cantidad</th><th>No. SAI</th><th>Firma</th><th>Observaciones</th></tr></thead><tbody>${filas}</tbody></table>`;descargarArchivo(`registros-combustible-${buscarFecha.value||'todos'}.xls`,tabla,'application/vnd.ms-excel');}
function exportarPdf(){window.print();}
buscarRegistro.addEventListener('input',pintarTarjetas);buscarFecha.addEventListener('input',pintarTarjetas);botonLimpiarBusqueda.addEventListener('click',()=>{buscarRegistro.value='';buscarFecha.value='';pintarTarjetas();});botonExportarExcel.addEventListener('click',exportarExcel);botonExportarPdf.addEventListener('click',exportarPdf);cargarRegistros();
