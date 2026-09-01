const cartasReportes = document.getElementById('cartas-reportes');
const botonActualizarReportes = document.getElementById('boton-actualizar-reportes');
const botonActualizarAnalitica = document.getElementById('boton-actualizar-analitica');
const analiticaMaquinas = document.getElementById('analitica-maquinas');

const nombresMeses = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

// Consulta las cartas mensuales generadas automaticamente en MySQL.
async function cargarReportes() {
  const respuesta = await fetch('/api/reportes');
  const reportes = await respuesta.json();
  pintarCartasReportes(reportes);
}

// Pinta una carta por cada mes generado en reportes_combustible.
function pintarCartasReportes(reportes) {
  cartasReportes.innerHTML = '';

  // Carta general para consultar rangos largos entre meses o durante todo el año.
  const cartaGeneral = document.createElement('button');
  cartaGeneral.type = 'button';
  cartaGeneral.className = 'carta-reporte';
  cartaGeneral.innerHTML = `
    <strong>Reporte general anual</strong>
    <span>Consulta reportes continuos</span>
    <span>resporte de maquinas y/o M1/M2</span>
    <em>GENERAL</em>
  `;

  cartaGeneral.addEventListener('click', () => {
    window.location.href = 'reporte-detalle.html?tipo=general';
  });

  cartasReportes.appendChild(cartaGeneral);

  reportes.forEach((reporte) => {
    const carta = document.createElement('button');
    carta.type = 'button';
    carta.className = 'carta-reporte';
    carta.innerHTML = `
      <strong>${nombresMeses[reporte.mes - 1]} ${reporte.anio}</strong>
      <span>${reporte.fechaInicio} hasta ${reporte.fechaFin}</span>
      <span>Cierre: ${reporte.fechaCierre}</span>
      <span>${reporte.totalRegistros} registros | ${Number(reporte.totalGalones || 0).toFixed(2)} galones</span>
      <em>${reporte.estado}</em>
    `;

    carta.addEventListener('click', () => {
      window.location.href = `reporte-detalle.html?anio=${reporte.anio}&mes=${reporte.mes}`;
    });
    cartasReportes.appendChild(carta);
  });
}

botonActualizarReportes.addEventListener('click', cargarReportes);
cargarReportes();

// Grafica de area con los galones despachados en los ultimos 7 dias,
// calculada con los registros reales del año en curso.
async function cargarConsumoSemanaReportes() {
  const grafica = document.getElementById('grafica-consumo-reportes');
  const vacio = document.getElementById('grafica-consumo-reportes-vacia');
  if (!grafica) return;

  try {
    const respuesta = await fetch('/api/reportes-general/registros', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const registros = await respuesta.json();

    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - i);
      dias.push(fecha.toISOString().slice(0, 10));
    }

    const totalesPorDia = dias.map((fecha) =>
      registros
        .filter((r) => String(r.fecha || '').slice(0, 10) === fecha && !Number(r.cierreDia))
        .reduce((total, r) => total + Number(r.cantidad || 0), 0)
    );
    const totalSemana = totalesPorDia.reduce((a, b) => a + b, 0);

    if (totalSemana <= 0) {
      grafica.hidden = true;
      if (vacio) vacio.hidden = false;
      return;
    }
    grafica.hidden = false;
    if (vacio) vacio.hidden = true;

    const ancho = 400;
    const alto = 150;
    const maximo = Math.max(...totalesPorDia, 1);
    const paso = ancho / (totalesPorDia.length - 1);
    const puntos = totalesPorDia.map((valor, indice) => {
      const x = indice * paso;
      const y = alto - (valor / maximo) * (alto - 20) - 10;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const linea = puntos.join(' ');
    const relleno = `0,${alto} ${linea} ${ancho},${alto}`;

    grafica.innerHTML = `
      <polygon points="${relleno}" fill="#f5a524" opacity=".14"></polygon>
      <polyline points="${linea}" fill="none" stroke="#f5a524" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    `;
  } catch (error) {
    console.warn('No se pudo cargar el consumo de los últimos 7 días', error);
  }
}

cargarConsumoSemanaReportes();


async function cargarAnaliticaMaquinas(){
  if(!analiticaMaquinas)return;
  try{
    const r=await fetch('/api/analitica/maquinas',{cache:'no-store'});
    if(!r.ok)throw new Error('No se pudo cargar el análisis.');
    const datos=await r.json();
    analiticaMaquinas.innerHTML='';
    if(!datos.length){analiticaMaquinas.innerHTML='<div class="estado-vacio-selector">No hay suficientes registros para mostrar análisis.</div>';return;}
    const maxTotal=Math.max(...datos.map(x=>Number(x.totalGalones)||0),1);
    datos.slice(0,8).forEach((x,i)=>{
      const card=document.createElement('article');
      const variacion=x.capacidadGalones>0?(Number(x.promedioGalones)/Number(x.capacidadGalones))*100:0;
      const estado=variacion>=85?'advertencia':'normal';
      const tipoMaquina=String(x.descripcion||'').trim().split(/\s+/)[0]||'';
      const tipoEtiqueta=tipoMaquina?tipoMaquina.charAt(0).toUpperCase()+tipoMaquina.slice(1).toLowerCase():'';
      card.className=`analitica-maquina-card ${estado}`;
      card.innerHTML=`<div class="analitica-card-top"><span class="ranking-analitica">#${i+1}</span><div><strong>${escapeHtml(x.maquina||'Sin máquina')}</strong><small>${x.registros} registros${tipoEtiqueta?` · <span class="badge-tipo-maquina">${escapeHtml(tipoEtiqueta)}</span>`:''}</small></div><b>${Number(x.totalGalones||0).toFixed(2)} GAL</b></div><div class="barra-analitica"><span style="width:${Math.min(100,Number(x.totalGalones||0)/maxTotal*100)}%"></span></div><div class="metricas-analitica"><span>Promedio <strong>${Number(x.promedioGalones||0).toFixed(2)} GAL</strong></span><span>Máximo <strong>${Number(x.maximoGalones||0).toFixed(2)} GAL</strong></span>${x.capacidadGalones?`<span>Tanque <strong>${Number(x.capacidadGalones).toFixed(2)} GAL</strong></span>`:''}</div>`;
      analiticaMaquinas.appendChild(card);
    });
  }catch(e){analiticaMaquinas.innerHTML='<div class="estado-vacio-selector">No se pudo cargar el análisis. Verifica la conexión con el servidor.</div>';}
}

botonActualizarAnalitica?.addEventListener('click',cargarAnaliticaMaquinas);
cargarAnaliticaMaquinas();
