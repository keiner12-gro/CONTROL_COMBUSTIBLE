const cuerpoAlertas=document.getElementById('cuerpo-alertas');
const resumenAlertas=document.getElementById('resumen-alertas');
const filtrosAlertas=document.getElementById('filtros-alertas');
const botonActualizar=document.getElementById('boton-actualizar-alertas');
function headersSesion(){return {'Content-Type':'application/json'};}

const TIPOS_ALERTA={
  sobrecapacidad:{label:'Sobrecapacidad',icon:'🔴'},
  promedio:{label:'Consumo fuera de promedio',icon:'🟠'},
  horometro_irregular:{label:'Horómetro irregular',icon:'🟡'},
  registro_incompleto:{label:'Registro incompleto',icon:'🔵'},
  inspeccion_pendiente:{label:'Inspección pendiente',icon:'🟣'}
};
const ORDEN_TIPOS=['sobrecapacidad','promedio','horometro_irregular','registro_incompleto','inspeccion_pendiente'];

let alertasCargadas=[];
let filtroTipo='todas';
let filtroEstado='todas';

function tarjetaResumen(label,valor,clase,dataEstado){return `<button type="button" class="mini-resumen ${clase} filtro-estado" data-estado="${dataEstado}"><span>${label}</span><strong>${valor}</strong></button>`;}

function alertasFiltradas(){
  return alertasCargadas.filter(a=>{
    const tipo=a.tipo_alerta||'sobrecapacidad';
    const estado=a.estado==='justificada'?'justificada':'pendiente';
    if(filtroTipo!=='todas'&&tipo!==filtroTipo)return false;
    if(filtroEstado!=='todas'&&estado!==filtroEstado)return false;
    return true;
  });
}

function renderizarResumen(){
  const pendientes=alertasCargadas.filter(a=>a.estado!=='justificada').length;
  const justificadas=alertasCargadas.filter(a=>a.estado==='justificada').length;
  resumenAlertas.innerHTML=tarjetaResumen('Total de alertas',alertasCargadas.length,'','todas')+tarjetaResumen('Pendientes',pendientes,'pendiente','pendiente')+tarjetaResumen('Justificadas',justificadas,'justificada','justificada');
  resumenAlertas.querySelectorAll('.filtro-estado').forEach(boton=>{
    boton.classList.toggle('activo',filtroEstado===boton.dataset.estado);
    boton.addEventListener('click',()=>{filtroEstado=boton.dataset.estado;renderizarResumen();renderizarFiltrosTipo();renderizarListado();});
  });
}

function renderizarFiltrosTipo(){
  const conteos=ORDEN_TIPOS.reduce((acc,t)=>{acc[t]=alertasCargadas.filter(a=>(a.tipo_alerta||'sobrecapacidad')===t).length;return acc;},{});
  const chips=[{tipo:'todas',icon:'📋',label:`Todas (${alertasCargadas.length})`}]
    .concat(ORDEN_TIPOS.map(t=>({tipo:t,icon:TIPOS_ALERTA[t].icon,label:`${TIPOS_ALERTA[t].label} (${conteos[t]})`})));
  filtrosAlertas.innerHTML='';
  chips.forEach(c=>{
    const boton=document.createElement('button');
    boton.type='button';
    boton.className=`filtro-chip${filtroTipo===c.tipo?' activo':''}`;
    boton.dataset.tipo=c.tipo;
    boton.textContent=`${c.icon} ${c.label}`;
    boton.addEventListener('click',()=>{filtroTipo=c.tipo;renderizarFiltrosTipo();renderizarListado();});
    filtrosAlertas.appendChild(boton);
  });
}

function tarjetaAlerta(a){
  const tipo=a.tipo_alerta||'sobrecapacidad';
  const info=TIPOS_ALERTA[tipo]||TIPOS_ALERTA.sobrecapacidad;
  const fecha=a.fecha?String(a.fecha).slice(0,10).split('-').reverse().join('/'):'Sin fecha';
  const cantidad=Number(a.cantidad||0), capacidad=Number(a.capacidad_galones||0), exceso=Number(a.exceso_galones||0);
  const porcentaje=capacidad?Math.min(100,Math.round(cantidad/capacidad*100)):0;
  const estado=a.estado==='justificada'?'justificada':'pendiente';
  const esMaquina=tipo!=='inspeccion_pendiente';

  let cuerpo='';
  if(tipo==='promedio'){
    cuerpo=`<div class="comparativo-alerta"><div><span>Promedio histórico</span><strong>${Number(a.promedio_galones||0).toFixed(2)} GAL</strong></div><div><span>Suministrado</span><strong>${cantidad.toFixed(2)} GAL</strong></div></div><div class="barra-capacidad"><span style="width:${Math.min(100,Math.round(Number(a.porcentaje_sobre_promedio||0)))}%"></span></div><div class="exceso-alerta"><span>Sobre el promedio</span><strong>+${Number(a.porcentaje_sobre_promedio||0).toFixed(1)}%</strong></div>`;
  }else if(tipo==='sobrecapacidad'){
    cuerpo=`<div class="comparativo-alerta"><div><span>Capacidad</span><strong>${capacidad.toFixed(2)} GAL</strong></div><div><span>Suministrado</span><strong>${cantidad.toFixed(2)} GAL</strong></div></div><div class="barra-capacidad"><span style="width:${porcentaje}%"></span></div><div class="exceso-alerta"><span>Exceso detectado</span><strong>+${exceso.toFixed(2)} GAL</strong></div>`;
  }else if(tipo==='horometro_irregular'){
    cuerpo=`<div class="detalle-alerta"><span>Valor de horómetro registrado</span><strong>${escapeHtml(a.detalle_alerta||'Sin valor numérico')}</strong></div>`;
  }else if(tipo==='registro_incompleto'){
    cuerpo=`<div class="detalle-alerta"><span>Información faltante</span><strong>${escapeHtml(a.detalle_alerta||'Datos requeridos')}</strong></div>`;
  }else if(tipo==='inspeccion_pendiente'){
    cuerpo=`<div class="detalle-alerta"><span>Estado del checklist</span><strong>Fuga de biodiésel, sistema eléctrico y parada de emergencia sin diligenciar</strong></div>`;
  }

  const card=document.createElement('article');
  card.className=`alerta-card ${estado} tipo-${tipo}`;
  card.innerHTML=`<div class="alerta-card-head"><div class="alerta-card-badges"><span class="badge-tipo-alerta tipo-${tipo}">${info.icon} ${info.label}</span><span class="badge-alerta ${estado}">${estado==='justificada'?'✓ Justificada':'Pendiente'}</span></div><span class="fecha-alerta">${fecha}</span></div><h3>${esMaquina?'🚜':'🗓'} ${escapeHtml(a.maquina||'Máquina')}</h3><p class="operario-alerta">👤 ${escapeHtml(a.operario||'Operario no registrado')}</p>${cuerpo}<div class="observacion-alerta"><span>Observaciones</span><p>${escapeHtml(a.observaciones||'Sin observaciones')}</p></div>`;

  const acciones=document.createElement('div'); acciones.className='acciones-alerta';
  if(a.estado==='justificada'){
    acciones.innerHTML='<span class="texto-estado">Justificación registrada</span>';
    if(a.reporte_ruta){const link=document.createElement('a');link.href=a.reporte_ruta;link.target='_blank';link.rel='noopener';link.textContent='📎 Ver reporte';acciones.appendChild(link);}
  }else{const b=document.createElement('button');b.type='button';b.textContent='✎ Justificar alerta';b.addEventListener('click',()=>justificarAlerta(a));acciones.appendChild(b);}
  card.appendChild(acciones);
  return card;
}

function renderizarListado(){
  const lista=alertasFiltradas();
  cuerpoAlertas.innerHTML='';
  if(!lista.length){
    cuerpoAlertas.innerHTML='<div class="estado-vacio"><div class="estado-vacio-icono">✓</div><h3>No hay alertas para este filtro</h3><p>Ajusta los filtros o vuelve a intentarlo más tarde.</p></div>';
    return;
  }
  lista.forEach(a=>cuerpoAlertas.appendChild(tarjetaAlerta(a)));
}

async function cargarAlertas(){
  const r=await fetch('/api/alertas'); const alertas=await r.json();
  alertasCargadas=Array.isArray(alertas)?alertas:[];
  renderizarResumen();
  renderizarFiltrosTipo();
  renderizarListado();
}

async function justificarAlerta(a){
  const html=`<textarea id="justificacion-alerta" class="swal2-textarea" placeholder="Explique el motivo de esta alerta."></textarea><input id="reporte-alerta" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="display:block;width:100%;margin-top:12px"><small style="display:block;text-align:left;margin-top:6px">Archivo opcional. Máximo 8 MB.</small>`;
  const r=await Swal.fire({icon:'warning',title:`Justificar ${a.maquina}`,html,showCancelButton:true,confirmButtonText:'Guardar justificación',cancelButtonText:'Cancelar',preConfirm:async()=>{const just=String(document.getElementById('justificacion-alerta').value||'').trim();const file=document.getElementById('reporte-alerta').files[0];if(!just){Swal.showValidationMessage('La justificación es obligatoria.');return;}if(!file)return {justificacion:just};if(file.size>8*1024*1024){Swal.showValidationMessage('El archivo debe pesar máximo 8 MB.');return;}const permitidos=['application/pdf','image/png','image/jpeg','image/webp'];if(file.type&&!permitidos.includes(file.type)){Swal.showValidationMessage('El archivo debe ser PDF, PNG, JPG o WEBP.');return;}const base64=await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=no;fr.readAsDataURL(file);});return {justificacion:just,reporteBase64:base64,reporteNombre:file.name,reporteTipo:file.type};}});
  if(!r.isConfirmed)return;try{const respuesta=await fetch(`/api/alertas/${a.id}`,{method:'PUT',headers:headersSesion(),body:JSON.stringify(r.value)});const datos=await respuesta.json().catch(()=>({}));if(!respuesta.ok)throw new Error(datos.mensaje||'No se pudo guardar la justificación.');await Swal.fire({icon:'success',title:'Alerta justificada',text:r.value.reporteBase64?'La justificación y el reporte quedaron asociados a la alerta.':'La justificación quedó asociada a la alerta.'});cargarAlertas();}catch(e){Swal.fire({icon:'error',title:'No se pudo guardar',text:e.message||'Intenta nuevamente.'});}}
botonActualizar.addEventListener('click',cargarAlertas);cargarAlertas();
