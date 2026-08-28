const tituloReporteMensual = document.getElementById('titulo-reporte-mensual');
const totalManguerasReporte = document.getElementById('total-mangueras-reporte');
const tituloChequeoReporte = document.getElementById('titulo-chequeo-reporte');
const tituloRegistrosReporte = document.getElementById('titulo-registros-reporte');
const cuerpoManguerasReporte = document.getElementById('cuerpo-mangueras-reporte');
const cuerpoChequeoReporte = document.getElementById('cuerpo-chequeo-reporte');
const cantidadRegistrosMes = document.getElementById('cantidad-registros-mes');
const cuerpoRegistrosMes = document.getElementById('cuerpo-registros-mes');
const mensajeRegistrosMes = document.getElementById('mensaje-registros-mes');
const cuerpoAlertasReporte = document.getElementById('cuerpo-alertas-reporte');
const rangoFechasReporte = document.getElementById('rango-fechas-reporte');
const fechaInicioReporte = document.getElementById('fecha-inicio-reporte');
const fechaFinReporte = document.getElementById('fecha-fin-reporte');
const buscarMaquinaReporte = document.getElementById('buscar-maquina-reporte');
const botonBuscarMaquina = document.getElementById('boton-buscar-maquina');
const botonLimpiarBusqueda = document.getElementById('boton-limpiar-busqueda');
const botonExportarPdfReporte = document.getElementById('boton-exportar-pdf-reporte');

const nombresMesesDetalle = [
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

const parametrosReporte = new URLSearchParams(window.location.search);
const esReporteGeneral = parametrosReporte.get('tipo') === 'general';
const anioReporte = Number(parametrosReporte.get('anio'));
const mesReporte = Number(parametrosReporte.get('mes'));
let registrosMensuales = [];
let graficaConsumoFecha = null;
let graficaM1M2 = null;
let graficaMaquinas = null;

const subtituloGraficasReporte = document.getElementById('subtitulo-graficas-reporte');
const totalConsumoGrafica = document.getElementById('total-consumo-grafica');
const resumenRegistrosGrafica = document.getElementById('resumen-registros-grafica');
const resumenConsumoGrafica = document.getElementById('resumen-consumo-grafica');
const resumenMaquinaGrafica = document.getElementById('resumen-maquina-grafica');
const tituloGraficaConsumo = document.getElementById('titulo-grafica-consumo');
const bloqueGraficaMaquinas = document.getElementById('bloque-grafica-maquinas');

function numeroGrafica(valor) {
  if (valor === null || valor === undefined || valor === '') {
    return 0;
  }

  // MySQL puede entregar DECIMAL como texto. Ademas aceptamos
  // valores escritos con coma decimal (por ejemplo, "125,50").
  if (typeof valor === 'string') {
    const texto = valor.trim().replace(/\s/g, '').replace(',', '.');
    const numero = Number(texto);
    return Number.isFinite(numero) ? numero : 0;
  }

  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function obtenerConsumoRegistro(registro) {
  // En los suministros, cantidad representa el combustible entregado.
  const cantidad = numeroGrafica(registro.cantidad);
  if (cantidad !== 0) return cantidad;

  // Compatibilidad con registros antiguos que pudieran guardar el dato
  // con otro nombre.
  const galones = numeroGrafica(registro.galones);
  if (galones !== 0) return galones;

  // En cierres diarios, el consumo de mangueras se obtiene de M1 + M2.
  const totalGalones = numeroGrafica(registro.totalGalones);
  if (totalGalones !== 0) return totalGalones;

  return numeroGrafica(registro.galonesM1) + numeroGrafica(registro.galonesM2);
}

// El consumo acumulado por maquina debe sumar solamente los suministros
// asociados a esa maquina. Los cierres M1/M2 no tienen maquina y nunca deben
// entrar en esta grafica.
function obtenerConsumoMaquina(registro) {
  const cantidad = numeroGrafica(registro.cantidad);

  if (cantidad !== 0) {
    return cantidad;
  }

  // Compatibilidad con datos antiguos.
  return numeroGrafica(registro.galones);
}

function destruirGraficas() {
  [graficaConsumoFecha, graficaM1M2, graficaMaquinas].forEach((grafica) => {
    if (grafica) grafica.destroy();
  });
  graficaConsumoFecha = null;
  graficaM1M2 = null;
  graficaMaquinas = null;
}

function agruparConsumoPorFecha(registros) {
  const mapa = new Map();
  registros.forEach((registro) => {
    if (!registro.fecha) return;
    const consumo = obtenerConsumoRegistro(registro);
    mapa.set(registro.fecha, (mapa.get(registro.fecha) || 0) + consumo);
  });
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function calcularConsumoM1M2(registros) {
  let m1 = 0;
  let m2 = 0;

  registros.forEach((registro) => {
    const inicialM1 = numeroGrafica(registro.m1Inicial);
    const finalM1 = numeroGrafica(registro.m1Final);
    const inicialM2 = numeroGrafica(registro.m2Inicial);
    const finalM2 = numeroGrafica(registro.m2Final);

    if (finalM1 > inicialM1) m1 += finalM1 - inicialM1;
    if (finalM2 > inicialM2) m2 += finalM2 - inicialM2;
  });

  // Si no existen cierres con lecturas completas, usamos los galones guardados.
  if (m1 === 0 && m2 === 0) {
    registros.forEach((registro) => {
      m1 += numeroGrafica(registro.galonesM1);
      m2 += numeroGrafica(registro.galonesM2);
    });
  }

  return { m1, m2 };
}

function agruparConsumoPorMaquina(registros) {
  const mapa = new Map();

  registros.forEach((registro) => {
    // Unicamente los registros que tienen maquina son suministros validos
    // para esta grafica.
    const maquina = String(registro.maquina || '').trim().toUpperCase();
    if (!maquina || esCierreDia(registro)) return;

    const consumo = obtenerConsumoMaquina(registro);
    if (!Number.isFinite(consumo) || consumo === 0) return;

    mapa.set(maquina, (mapa.get(maquina) || 0) + consumo);
  });

  return [...mapa.entries()]
    .sort((a, b) => b[1] - a[1]);
}

function actualizarGraficas(registros) {
  if (typeof Chart === 'undefined') return;

  destruirGraficas();

  const lista = Array.isArray(registros) ? registros : [];
  const busqueda = String(buscarMaquinaReporte.value || '').trim();
  const maquinaSeleccionada = busqueda || 'GENERAL';
  const totalConsumo = lista.reduce((total, registro) => total + obtenerConsumoRegistro(registro), 0);
  const consumoFechas = agruparConsumoPorFecha(lista);
  const consumoMangueras = calcularConsumoM1M2(lista);
  const consumoMaquinas = agruparConsumoPorMaquina(lista);

  totalConsumoGrafica.textContent = totalConsumo.toFixed(2);
  resumenConsumoGrafica.textContent = totalConsumo.toFixed(2);
  resumenRegistrosGrafica.textContent = String(lista.filter((registro) => !esCierreDia(registro)).length);
  resumenMaquinaGrafica.textContent = maquinaSeleccionada.toUpperCase();

  if (busqueda) {
    subtituloGraficasReporte.textContent = `Consumo filtrado de ${busqueda.toUpperCase()}`;
    tituloGraficaConsumo.textContent = `Consumo de ${busqueda.toUpperCase()} por fecha`;
    bloqueGraficaMaquinas.hidden = true;
  } else {
    subtituloGraficasReporte.textContent = 'Vista general de todos los registros';
    tituloGraficaConsumo.textContent = 'Consumo general de combustible por fecha';
    bloqueGraficaMaquinas.hidden = false;
  }

  const opcionesComunes = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true }
    }
  };

  graficaConsumoFecha = new Chart(document.getElementById('grafica-consumo-fecha'), {
    type: 'line',
    data: {
      labels: consumoFechas.map(([fecha]) => fecha),
      datasets: [{
        label: 'Galones consumidos',
        data: consumoFechas.map(([, consumo]) => Number(consumo.toFixed(2))),
        tension: 0.25,
        fill: false
      }]
    },
    options: opcionesComunes
  });

  graficaM1M2 = new Chart(document.getElementById('grafica-m1-m2'), {
    type: 'bar',
    data: {
      labels: ['M1', 'M2'],
      datasets: [{
        label: 'Galones consumidos',
        data: [Number(consumoMangueras.m1.toFixed(2)), Number(consumoMangueras.m2.toFixed(2))]
      }]
    },
    options: opcionesComunes
  });

  const canvasMaquinas = document.getElementById('grafica-maquinas');
  const contenedorMaquinas = canvasMaquinas?.parentElement;

  // La grafica es horizontal. Ajustamos su altura segun la cantidad de
  // maquinas para que las etiquetas y las barras no se amontonen.
  if (contenedorMaquinas) {
    const alturaMaquinas = Math.max(320, consumoMaquinas.length * 30 + 70);
    contenedorMaquinas.style.height = `${alturaMaquinas}px`;
  }

  graficaMaquinas = new Chart(canvasMaquinas, {
    type: 'bar',
    data: {
      labels: consumoMaquinas.map(([maquina]) => maquina),
      datasets: [{
        label: 'Galones consumidos',
        data: consumoMaquinas.map(([, consumo]) => Number(consumo.toFixed(2))),
        borderWidth: 1
      }]
    },
    options: {
      ...opcionesComunes,
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Galones'
          },
          ticks: {
            precision: 0
          }
        },
        y: {
          ticks: {
            autoSkip: false
          }
        }
      }
    }
  });
}


// Convierte numeros vacios o nulos a texto limpio para la tabla.
function mostrarNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : '';
}

// Normaliza textos para que la busqueda funcione aunque escriban espacios, acentos o mayusculas diferentes.
function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}

// Filtra registros por maquina u operario usando texto normalizado.
function filtrarRegistrosPorBusqueda(registros, textoBusqueda) {
  const busqueda = normalizarTexto(textoBusqueda);

  if (!busqueda) {
    return registros;
  }

  return registros.filter((registro) => {
    const maquina = normalizarTexto(registro.maquina);
    const operario = normalizarTexto(registro.operario);

    return maquina.includes(busqueda) || operario.includes(busqueda);
  });
}

// Define por defecto el rango del anio actual para el reporte general.
function prepararRangoAnual() {
  const anioActual = new Date().getFullYear();
  fechaInicioReporte.value = `${anioActual}-01-01`;
  fechaFinReporte.value = `${anioActual}-12-31`;
}

// Carga registros por rango de fechas y busqueda libre para el reporte general.
async function cargarReporteGeneral() {
  const parametros = new URLSearchParams({
    fechaInicio: fechaInicioReporte.value,
    fechaFin: fechaFinReporte.value
  });

  const respuesta = await fetch(`/api/reportes-general/registros?${parametros.toString()}`);
  const registros = await respuesta.json();
  registrosMensuales = filtrarRegistrosPorBusqueda(registros, buscarMaquinaReporte.value);
  pintarVistaReporte(registrosMensuales);
  await cargarAlertasReporte();
}

// Carga los registros del mes indicado en la URL o el reporte general.

async function cargarAlertasReporte() {
  if (!cuerpoAlertasReporte) return;
  let url='';
  if (esReporteGeneral) {
    url='/api/alertas';
  } else if (anioReporte && mesReporte) {
    url=`/api/alertas/reportes/${anioReporte}/${mesReporte}`;
  } else return;
  try {
    const respuesta=await fetch(url); const alertas=await respuesta.json(); cuerpoAlertasReporte.innerHTML='';
    if(!alertas.length){cuerpoAlertasReporte.innerHTML='<tr><td colspan="8">No hay alertas de sobrecapacidad.</td></tr>';return;}
    alertas.forEach(a=>{const fila=document.createElement('tr');[a.fecha,a.maquina,Number(a.cantidad||0).toFixed(2),Number(a.capacidad_galones||0).toFixed(2),Number(a.exceso_galones||0).toFixed(2),a.estado||'pendiente',a.justificacion||'Sin justificación'].forEach(v=>{const td=document.createElement('td');td.textContent=v;fila.appendChild(td);});const td=document.createElement('td');if(a.reporte_ruta){const link=document.createElement('a');link.href=a.reporte_ruta;link.target='_blank';link.textContent='Abrir reporte';td.appendChild(link);}else td.textContent='Sin reporte';fila.appendChild(td);cuerpoAlertasReporte.appendChild(fila);});
  } catch(e){console.warn('No se pudieron cargar alertas del reporte',e);}
}
async function cargarDetalleMensual() {
  if (esReporteGeneral) {
    tituloReporteMensual.textContent = 'Reporte general anual';
    tituloChequeoReporte.textContent = 'Chequeo del reporte';
    tituloRegistrosReporte.textContent = 'Registros del reporte';
    rangoFechasReporte.hidden = false;
    prepararRangoAnual();
    await cargarReporteGeneral();
    await cargarAlertasReporte();
    return;
  }

  if (!anioReporte || !mesReporte) {
    tituloReporteMensual.textContent = 'Reporte no encontrado';
    return;
  }

  tituloReporteMensual.textContent = `${nombresMesesDetalle[mesReporte - 1]} ${anioReporte}`;

  const respuesta = await fetch(`/api/reportes/${anioReporte}/${mesReporte}/registros`);
  const registros = await respuesta.json();
  registrosMensuales = registros;

  pintarVistaReporte(registrosMensuales);
  await cargarAlertasReporte();
}

// Filtra por maquina o por nombre del operario.
function buscarReporteMensual() {
  if (esReporteGeneral) {
    cargarReporteGeneral();
    return;
  }

  pintarVistaReporte(filtrarRegistrosPorBusqueda(registrosMensuales, buscarMaquinaReporte.value));
}

// Regresa la vista a todos los registros del mes.
function limpiarBusquedaReporte() {
  buscarMaquinaReporte.value = '';

  if (esReporteGeneral) {
    prepararRangoAnual();
    cargarReporteGeneral();
    return;
  }

  pintarVistaReporte(registrosMensuales);
}

// Abre todas las secciones para que el PDF incluya el reporte completo.
function exportarPdfReporte() {
  const secciones = [...document.querySelectorAll('.desplegable-reporte')];
  const estadosOriginales = secciones.map((seccion) => seccion.open);

  secciones.forEach((seccion) => {
    seccion.open = true;
  });

  const restaurarSecciones = () => {
    secciones.forEach((seccion, indice) => {
      seccion.open = estadosOriginales[indice];
    });
    window.removeEventListener('afterprint', restaurarSecciones);
  };

  window.addEventListener('afterprint', restaurarSecciones);
  window.print();
}

// Identifica un cierre de dia de forma robusta.
// Prioriza la marca enviada por el servidor y mantiene compatibilidad con cierres historicos.
function esCierreDia(registro) {
  const valor = registro?.cierreDia;

  if (valor === true || valor === 1 || valor === '1' || valor === 'true') {
    return true;
  }

  const tieneLecturas = [
    registro?.m1Inicial,
    registro?.m1Final,
    registro?.m2Inicial,
    registro?.m2Final
  ].every((lectura) => lectura !== null && lectura !== undefined && String(lectura).trim() !== '');

  const sinSuministro =
    !String(registro?.operario || '').trim() &&
    !String(registro?.maquina || '').trim();

  return tieneLecturas && sinSuministro;
}

// Pinta las tres secciones usando exactamente los registros recibidos desde MySQL.
// Los cierres no se eliminan: solo se separan visualmente de los suministros.
function pintarVistaReporte(registros) {
  const lista = Array.isArray(registros) ? registros : [];
  const cierres = lista.filter(esCierreDia);
  const suministros = lista.filter((registro) => !esCierreDia(registro));

  pintarChequeoReporte(lista);
  pintarRegistroDiarioMangueras(cierres);
  pintarRegistrosDelMes(suministros);
  actualizarGraficas(lista);
}

// Pinta los datos del checklist guardado desde el formulario principal.
function pintarChequeoReporte(registros) {
  cuerpoChequeoReporte.innerHTML = '';
  const chequeosPorFecha = new Map();

  registros.forEach((registro) => {
    const tieneChequeo = registro.fugaBiodiesel || registro.sistemaElectrico || registro.paradaEmergencia;

    if (!registro.fecha || !tieneChequeo || chequeosPorFecha.has(registro.fecha)) {
      return;
    }

    chequeosPorFecha.set(registro.fecha, registro);
  });

  chequeosPorFecha.forEach((registro) => {
    const fila = document.createElement('tr');
    const datos = [
      registro.fecha,
      registro.fugaBiodiesel,
      registro.sistemaElectrico,
      registro.paradaEmergencia
    ];

    datos.forEach((dato) => {
      const celda = document.createElement('td');
      celda.textContent = dato || '';
      fila.appendChild(celda);
    });

    cuerpoChequeoReporte.appendChild(fila);
  });
}

// Pinta la lectura diaria de mangueras M1 y M2.
function pintarRegistroDiarioMangueras(registros) {
  const totalMangueras = registros.reduce((total, registro) => {
    return total + (Number(registro.totalGalones) || 0);
  }, 0);

  totalManguerasReporte.textContent = totalMangueras.toFixed(2);
  cuerpoManguerasReporte.innerHTML = '';

  registros.forEach((registro) => {
    const fila = document.createElement('tr');
    const datos = [
      registro.fecha,
      mostrarNumero(registro.m1Inicial),
      mostrarNumero(registro.m1Final),
      mostrarNumero(registro.galonesM1),
      mostrarNumero(registro.m2Inicial),
      mostrarNumero(registro.m2Final),
      mostrarNumero(registro.galonesM2),
      mostrarNumero(registro.totalGalones)
    ];

    datos.forEach((dato) => {
      const celda = document.createElement('td');
      celda.textContent = dato || '';
      fila.appendChild(celda);
    });

    cuerpoManguerasReporte.appendChild(fila);
  });
}

// Pinta la tabla completa de registros del mes seleccionado.
function pintarRegistrosDelMes(registros) {
  cuerpoRegistrosMes.innerHTML = '';
  cantidadRegistrosMes.textContent = registros.length;
  mensajeRegistrosMes.hidden = registros.length > 0;

  registros.forEach((registro) => {
    const fila = document.createElement('tr');
    const datos = [
      registro.fecha,
      registro.operario,
      registro.cedula,
      registro.maquina,
      registro.horometro,
      mostrarNumero(registro.cantidad),
      registro.numeroSai,
      registro.observaciones
    ];

    datos.forEach((dato) => {
      const celda = document.createElement('td');
      celda.textContent = dato || '';
      fila.appendChild(celda);
    });

    cuerpoRegistrosMes.appendChild(fila);
  });
}

botonBuscarMaquina.addEventListener('click', buscarReporteMensual);
botonLimpiarBusqueda.addEventListener('click', limpiarBusquedaReporte);
botonExportarPdfReporte.addEventListener('click', exportarPdfReporte);
buscarMaquinaReporte.addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') {
    buscarReporteMensual();
  }
});

cargarDetalleMensual();


// Actualiza las graficas y tablas automaticamente mientras la vista permanece abierta.
// No requiere recargar manualmente la pagina despues de registrar un nuevo combustible.
setInterval(async () => {
  try {
    if (esReporteGeneral) {
      await cargarReporteGeneral();
    } else if (anioReporte && mesReporte) {
      const respuesta = await fetch(`/api/reportes/${anioReporte}/${mesReporte}/registros`);
      const registros = await respuesta.json();
      registrosMensuales = registros;
      pintarVistaReporte(filtrarRegistrosPorBusqueda(registrosMensuales, buscarMaquinaReporte.value));
    }
  } catch (error) {
    console.warn('No fue posible actualizar automaticamente el reporte:', error);
  }
}, 10000);
