const cuerpoAlertas=document.getElementById('cuerpo-alertas');
const resumenAlertas=document.getElementById('resumen-alertas');
const botonActualizar=document.getElementById('boton-actualizar-alertas');
function headersSesion(){return {'Content-Type':'application/json'};}
function escapeHtml(v=''){const d=document.createElement('div');d.textContent=String(v);return d.innerHTML;}
function tarjetaResumen(label,valor,clase=''){return `<div class="mini-resumen ${clase}"><span>${label}</span><strong>${valor}</strong></div>`;}
async function cargarAlertas(){
  const r=await fetch('/api/alertas'); const alertas=await r.json();
  cuerpoAlertas.innerHTML='';
  const pendientes=alertas.filter(a=>a.estado!=='justificada').length;
  const justificadas=alertas.filter(a=>a.estado==='justificada').length;
  resumenAlertas.innerHTML=tarjetaResumen('Total de alertas',alertas.length)+tarjetaResumen('Pendientes',pendientes,'pendiente')+tarjetaResumen('Justificadas',justificadas,'justificada');
  if(!alertas.length){cuerpoAlertas.innerHTML='<div class="estado-vacio"><div class="estado-vacio-icono">✓</div><h3>No hay alertas pendientes</h3><p>Los suministros registrados están dentro de las capacidades configuradas.</p></div>';return;}
  alertas.forEach(a=>{
    const fecha=a.fecha?String(a.fecha).slice(0,10).split('-').reverse().join('/'):'Sin fecha';
    const cantidad=Number(a.cantidad||0), capacidad=Number(a.capacidad_galones||0), exceso=Number(a.exceso_galones||0);
    const porcentaje=capacidad?Math.min(100,Math.round(cantidad/capacidad*100)):0;
    const esPromedio=a.tipo_alerta==='promedio';
    const estado=a.estado==='justificada'?'justificada':'pendiente';
    const tituloAlerta=esPromedio?'⚠ CONSUMO SOBRE PROMEDIO':'⚠ REQUIERE REVISIÓN';
    const comparativo=esPromedio?`<div><span>Promedio histórico</span><strong>${Number(a.promedio_galones||0).toFixed(2)} GAL</strong></div><div><span>Suministrado</span><strong>${cantidad.toFixed(2)} GAL</strong></div>`:`<div><span>Capacidad</span><strong>${capacidad.toFixed(2)} GAL</strong></div><div><span>Suministrado</span><strong>${cantidad.toFixed(2)} GAL</strong></div>`;
    const barra=esPromedio?`<div class="barra-capacidad"><span style="width:${Math.min(100,Math.round(Number(a.porcentaje_sobre_promedio||0)))}%"></span></div>`:`<div class="barra-capacidad"><span style="width:${porcentaje}%"></span></div>`;
    const excesoTexto=esPromedio?`<span>Sobre el promedio</span><strong>+${Number(a.porcentaje_sobre_promedio||0).toFixed(1)}%</strong>`:`<span>Exceso detectado</span><strong>+${exceso.toFixed(2)} GAL</strong>`;
    const card=document.createElement('article'); card.className=`alerta-card ${estado} ${esPromedio?'alerta-promedio':''}`;
    card.innerHTML=`<div class="alerta-card-head"><span class="badge-alerta ${estado}">${estado==='justificada'?'✓ JUSTIFICADA':tituloAlerta}</span><span class="fecha-alerta">${fecha}</span></div><h3>🚜 ${escapeHtml(a.maquina||'Máquina')}</h3><p class="operario-alerta">👤 ${escapeHtml(a.operario||'Operario no registrado')}</p><div class="comparativo-alerta">${comparativo}</div>${barra}<div class="exceso-alerta">${excesoTexto}</div><div class="observacion-alerta"><span>Observaciones</span><p>${escapeHtml(a.observaciones||'Sin observaciones')}</p></div>`;
    const acciones=document.createElement('div'); acciones.className='acciones-alerta';
    if(a.estado==='justificada'){
      acciones.innerHTML='<span class="texto-estado">Justificación registrada</span>';
      if(a.reporte_ruta){const link=document.createElement('a');link.href=a.reporte_ruta;link.target='_blank';link.rel='noopener';link.textContent='📎 Ver reporte';acciones.appendChild(link);}
    }else{const b=document.createElement('button');b.type='button';b.textContent='✎ Justificar alerta';b.addEventListener('click',()=>justificarAlerta(a));acciones.appendChild(b);}
    card.appendChild(acciones); cuerpoAlertas.appendChild(card);
  });
}
async function justificarAlerta(a){
  const html=`<textarea id="justificacion-alerta" class="swal2-textarea" placeholder="Explique por qué se excedió la capacidad."></textarea><input id="reporte-alerta" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="display:block;width:100%;margin-top:12px"><small style="display:block;text-align:left;margin-top:6px">Archivo opcional. Máximo 8 MB.</small>`;
  const r=await Swal.fire({icon:'warning',title:`Justificar ${a.maquina}`,html,showCancelButton:true,confirmButtonText:'Guardar justificación',cancelButtonText:'Cancelar',preConfirm:async()=>{const just=String(document.getElementById('justificacion-alerta').value||'').trim();const file=document.getElementById('reporte-alerta').files[0];if(!just){Swal.showValidationMessage('La justificación es obligatoria.');return;}if(!file)return {justificacion:just};if(file.size>8*1024*1024){Swal.showValidationMessage('El archivo debe pesar máximo 8 MB.');return;}const permitidos=['application/pdf','image/png','image/jpeg','image/webp'];if(file.type&&!permitidos.includes(file.type)){Swal.showValidationMessage('El archivo debe ser PDF, PNG, JPG o WEBP.');return;}const base64=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=no;fr.readAsDataURL(file);});return {justificacion:just,reporteBase64:base64,reporteNombre:file.name,reporteTipo:file.type};}});
  if(!r.isConfirmed)return;try{const respuesta=await fetch(`/api/alertas/${a.id}`,{method:'PUT',headers:headersSesion(),body:JSON.stringify(r.value)});const datos=await respuesta.json().catch(()=>({}));if(!respuesta.ok)throw new Error(datos.mensaje||'No se pudo guardar la justificación.');await Swal.fire({icon:'success',title:'Alerta justificada',text:r.value.reporteBase64?'La justificación y el reporte quedaron asociados a la alerta.':'La justificación quedó asociada a la alerta.'});cargarAlertas();}catch(e){Swal.fire({icon:'error',title:'No se pudo guardar',text:e.message||'Intenta nuevamente.'});}}
botonActualizar.addEventListener('click',cargarAlertas);cargarAlertas();
