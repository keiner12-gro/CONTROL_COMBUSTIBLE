const nombreSesion=document.getElementById('nombre-sesion');
const sesionActual=obtenerSesionActual();
const normalizarRol=(r)=>String(r||'').replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
if(sesionActual){
  const nombre=sesionActual.usuario||'usuario';
  document.getElementById('nombre-usuario-dashboard')?.replaceChildren(document.createTextNode(nombre));
  document.getElementById('rol-usuario-dashboard')?.replaceChildren(document.createTextNode(normalizarRol(sesionActual.rol)));
  document.getElementById('mensaje-rol-dashboard')?.replaceChildren(document.createTextNode(sesionActual.rol==='operario'?'Registra tus suministros de forma rápida y segura.':sesionActual.rol==='supervisor'?'Revisa consumos, registros y alertas del día.':'Gestiona las operaciones y los procesos del surtidor.'));
}
const panel=document.getElementById('panel-notificaciones'),lista=document.getElementById('lista-notificaciones'),contador=document.getElementById('contador-notificaciones');
async function cargarNotificaciones(){
 if(!sesionActual||!usuarioTienePermiso('alertas'))return;
 try{const r=await fetch('/api/notificaciones',{headers:{},cache:'no-store'});if(!r.ok)return;const datos=await r.json();const pendientes=datos.filter(n=>Number(n.leida)===0);if(contador)contador.textContent=String(pendientes.length);if(panel)panel.hidden=pendientes.length===0;const badge=document.getElementById('dashboard-alerta-badge');if(badge){badge.hidden=!pendientes.length;badge.textContent=pendientes.length>9?'9+':String(pendientes.length)}const dash=document.getElementById('dashboard-alertas');if(dash)dash.textContent=String(pendientes.length);if(lista){lista.innerHTML='';pendientes.slice(0,5).forEach(n=>{const d=document.createElement('div');d.className='notificacion-item';d.innerHTML=`<strong>${escapeHtml(n.titulo)}</strong><p>${escapeHtml(n.mensaje)}</p>`;const b=document.createElement('button');b.type='button';b.textContent='Ver alerta';b.onclick=()=>window.location.replace('alertas.html');d.appendChild(b);lista.appendChild(d)})}}
 catch(e){console.warn('No se pudieron cargar las notificaciones',e)}
}
async function cargarResumen(){try{const r=await fetch('/api/registros',{cache:'no-store'});if(!r.ok)return;const registros=await r.json();const hoy=new Date().toISOString().slice(0,10);const delDia=registros.filter(x=>String(x.fecha||'').slice(0,10)===hoy&&!Number(x.cierreDia));const gal=delDia.reduce((a,x)=>a+Number(x.cantidad||0),0);document.getElementById('dashboard-galones')?.replaceChildren(document.createTextNode(`${gal.toFixed(2)} GAL`));document.getElementById('dashboard-registros')?.replaceChildren(document.createTextNode(String(delDia.length)))}catch(e){}}
cargarNotificaciones();cargarResumen();setInterval(cargarNotificaciones,10000);setInterval(cargarResumen,30000);
document.querySelector('.nav-movil-menu')?.addEventListener('click',()=>document.querySelector('.boton-tres-puntos')?.click());
                                                                                                                                                                                                                                                                                                                                                            