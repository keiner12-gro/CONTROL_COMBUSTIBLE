// ============================================================================
// menu.js — PANEL DE INICIO / DASHBOARD (public/html/menu.html)
// ----------------------------------------------------------------------------
// Pinta la pantalla de bienvenida con:
//   * saludo personalizado según el rol,
//   * tarjetas de indicadores (galones de hoy, registros, alertas, máquinas),
//   * gráfica de consumo de los últimos 7 días (SVG dibujado a mano),
//   * ranking de máquinas del mes y lista de alertas recientes.
// Todo se calcula en el navegador a partir de /api/registros y /api/alertas.
// Los datos se refrescan solos: alertas cada 15 s y resumen cada 30 s.
// ============================================================================

const sesionActual = obtenerSesionActual();

// "super_administrador" -> "Super Administrador" (para mostrarlo bonito).
const normalizarRol = (valor) =>
  String(valor || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letra) => letra.toUpperCase()); // Mayúscula inicial de cada palabra

// --- Saludo personalizado ---------------------------------------------------
// replaceChildren con un nodo de texto = forma segura de escribir texto
// (equivale a textContent y nunca interpreta HTML). El "?." evita errores si
// el elemento no existe en esta página.
if (sesionActual) {
  const nombre = sesionActual.usuario || 'usuario';
  document.getElementById('nombre-usuario-dashboard')?.replaceChildren(document.createTextNode(nombre));
  document
    .getElementById('rol-usuario-dashboard')
    ?.replaceChildren(document.createTextNode(normalizarRol(sesionActual.rol)));
  // Mensaje distinto según el rol de quien entra.
  document.getElementById('mensaje-rol-dashboard')?.replaceChildren(
    document.createTextNode(
      sesionActual.rol === 'operario'
        ? 'Registra tus suministros de forma rápida y segura.'
        : sesionActual.rol === 'supervisor'
          ? 'Revisa consumos, registros y alertas del día.'
          : 'Gestiona las operaciones y los procesos del surtidor.'
    )
  );
}

// Color del punto según el tipo de alerta.
const ICONOS_ALERTA = {
  sobrecapacidad: '🔴',
  promedio: '🟠',
  horometro_irregular: '🟡',
  inspeccion_pendiente: '🟣',
  cierre_pendiente: '⏰'
};

// Texto corto que describe cada tipo de alerta.
function descripcionAlerta(tipo) {
  switch (tipo) {
    case 'promedio':
      return 'Consumo superior al promedio';
    case 'horometro_irregular':
      return 'Horómetro irregular';
    case 'inspeccion_pendiente':
      return 'Inspección pendiente';
    case 'cierre_pendiente':
      return 'Jornada sin cerrar';
    default:
      return 'Sobre capacidad detectada';
  }
}

// Reutiliza el mismo listado de /api/alertas para el contador del panel de
// KPIs y para la mini-lista "Alertas recientes" del inicio.
async function cargarAlertasRecientes() {
  const tarjeta = document.getElementById('tarjeta-alertas-recientes');
  // Si el usuario no tiene permiso sobre alertas, la tarjeta entera se oculta.
  if (!sesionActual || typeof usuarioTienePermiso !== 'function' || !usuarioTienePermiso('alertas')) {
    if (tarjeta) tarjeta.hidden = true;
    return;
  }

  try {
    const respuesta = await fetch('/api/alertas', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const alertas = await respuesta.json();
    const pendientes = alertas.filter((alerta) => alerta.estado !== 'justificada'); // Solo sin justificar

    // Contador del indicador "Alertas".
    document.getElementById('dashboard-alertas')?.replaceChildren(document.createTextNode(String(pendientes.length)));

    // Lista con las 3 alertas pendientes más recientes.
    const lista = document.getElementById('lista-alertas-recientes');
    if (lista) {
      lista.innerHTML = '';
      pendientes.slice(0, 3).forEach((alerta) => {
        const tipo = alerta.tipo_alerta || 'sobrecapacidad';
        const item = document.createElement('div');
        item.className = `alerta-reciente-item tipo-${tipo}`; // La clase define el color
        item.innerHTML = `
          <i></i>
          <div>
            <strong>${escapeHtml(alerta.maquina || 'Máquina')}</strong>
            <span>${ICONOS_ALERTA[tipo] || '🔔'} ${escapeHtml(descripcionAlerta(tipo))}</span>
          </div>
        `;
        lista.appendChild(item);
      });
    }

    // Mensaje "sin alertas" cuando la lista quedó vacía.
    const vacio = document.getElementById('alertas-recientes-vacio');
    if (vacio) vacio.hidden = pendientes.length > 0;
  } catch (error) {
    console.warn('No se pudieron cargar las alertas recientes', error);
  }
}

// Calcula los indicadores del día y dispara el dibujo de las dos gráficas.
async function cargarResumen() {
  try {
    const respuesta = await fetch('/api/registros', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const registros = await respuesta.json();

    // Registros de hoy, excluyendo los cierres de día (no son suministros).
    const hoy = fechaLocalISO();
    const delDia = registros.filter((r) => String(r.fecha || '').slice(0, 10) === hoy && !Number(r.cierreDia));
    const galonesHoy = delDia.reduce((total, r) => total + Number(r.cantidad || 0), 0);

    document
      .getElementById('dashboard-galones')
      ?.replaceChildren(document.createTextNode(`${galonesHoy.toFixed(2)} GAL`));
    document.getElementById('dashboard-registros')?.replaceChildren(document.createTextNode(String(delDia.length)));

    // Con la misma descarga se alimentan las dos visualizaciones.
    dibujarConsumoSemana(registros);
    dibujarConsumoPorMaquina(registros);
  } catch (error) {
    console.warn('No se pudo cargar el resumen de registros', error);
  }
}

// Ranking horizontal de las maquinas con mas galones despachados en el mes
// en curso, calculado con los mismos registros que ya se cargan arriba.
function dibujarConsumoPorMaquina(registros) {
  const contenedor = document.getElementById('ranking-consumo-maquinas');
  const vacio = document.getElementById('ranking-consumo-vacio');
  if (!contenedor) return;

  const mesActual = fechaLocalISO().slice(0, 7); // "2026-09"
  const totalesPorMaquina = new Map(); // máquina -> galones acumulados

  // Se suman los galones del mes agrupando por nombre de máquina.
  registros
    .filter((r) => !Number(r.cierreDia) && String(r.fecha || '').slice(0, 7) === mesActual)
    .forEach((r) => {
      const nombre = String(r.maquina || 'Sin máquina').trim() || 'Sin máquina';
      totalesPorMaquina.set(nombre, (totalesPorMaquina.get(nombre) || 0) + Number(r.cantidad || 0));
    });

  // Se ordena de mayor a menor y se muestran las 6 primeras.
  const ranking = Array.from(totalesPorMaquina.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (!ranking.length) {
    contenedor.innerHTML = '';
    if (vacio) vacio.hidden = false; // Se muestra el mensaje de "sin datos"
    return;
  }
  if (vacio) vacio.hidden = true;

  // El primer puesto marca el 100% de la barra; el mínimo es 4% para que
  // incluso los valores pequeños se vean.
  const maximo = ranking[0][1] || 1;
  contenedor.innerHTML = ranking
    .map(([nombre, total]) => {
      const porcentaje = Math.max(4, Math.round((total / maximo) * 100));
      return `
        <div class="fila-ranking-maquina">
          <span class="nombre-ranking-maquina">${escapeHtml(nombre)}</span>
          <span class="pista-ranking-maquina"><span style="width:${porcentaje}%"></span></span>
          <span class="valor-ranking-maquina">${total.toFixed(1)} GAL</span>
        </div>
      `;
    })
    .join('');
}

// Grafica de area con los galones despachados en los ultimos 7 dias,
// calculada con los mismos registros que ya se cargan para el resumen.
// Se dibuja como SVG a mano, sin librerías externas.
function dibujarConsumoSemana(registros) {
  const grafica = document.getElementById('grafica-consumo-semana');
  const vacio = document.getElementById('grafica-consumo-vacia');
  if (!grafica) return;

  // Lista de los últimos 7 días, del más antiguo al de hoy.
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    dias.push(fechaLocalISO(fecha));
  }

  // Total de galones de cada uno de esos días.
  const totalesPorDia = dias.map((fecha) =>
    registros
      .filter((r) => String(r.fecha || '').slice(0, 10) === fecha && !Number(r.cierreDia))
      .reduce((total, r) => total + Number(r.cantidad || 0), 0)
  );
  const totalSemana = totalesPorDia.reduce((a, b) => a + b, 0);

  // Sin movimiento en la semana se oculta la gráfica y se muestra el aviso.
  if (totalSemana <= 0) {
    grafica.hidden = true;
    if (vacio) vacio.hidden = false;
    return;
  }
  grafica.hidden = false;
  if (vacio) vacio.hidden = true;

  // Cálculo de coordenadas del SVG.
  const ancho = 400; // Ancho del lienzo
  const alto = 150; // Alto del lienzo
  const maximo = Math.max(...totalesPorDia, 1); // El día más alto toca el techo
  const paso = ancho / (totalesPorDia.length - 1); // Separación horizontal entre puntos
  const puntos = totalesPorDia.map((valor, indice) => {
    const x = indice * paso;
    // En SVG el eje Y crece hacia abajo: por eso se resta. El -10/-20 deja
    // un margen para que la línea no quede pegada a los bordes.
    const y = alto - (valor / maximo) * (alto - 20) - 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linea = puntos.join(' ');
  // El relleno cierra la figura bajando a la base en ambos extremos.
  const relleno = `0,${alto} ${linea} ${ancho},${alto}`;

  // polygon = área naranja translúcida; polyline = la línea superior.
  grafica.innerHTML = `
    <polygon points="${relleno}" fill="#f5a524" opacity=".14"></polygon>
    <polyline points="${linea}" fill="none" stroke="#f5a524" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
  `;
}

// Indicador con el total de máquinas activas del catálogo.
async function cargarConteoMaquinas() {
  const destino = document.getElementById('dashboard-maquinas');
  if (!destino) return;
  try {
    // ?selector=1 permite consultarlo con el permiso 'registro' (ver tractor.routes.js).
    const respuesta = await fetch('/api/tractores?selector=1', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const maquinas = await respuesta.json();
    destino.textContent = String(maquinas.length);
  } catch (error) {
    console.warn('No se pudo cargar el total de máquinas', error);
  }
}

// --- Arranque de la pantalla y refresco automático --------------------------
cargarAlertasRecientes();
cargarResumen();
cargarConteoMaquinas(); // El conteo de máquinas no se refresca: cambia poco
setInterval(cargarAlertasRecientes, 15000); // Cada 15 segundos
setInterval(cargarResumen, 30000); // Cada 30 segundos
