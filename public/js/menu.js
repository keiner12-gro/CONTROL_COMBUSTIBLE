const sesionActual = obtenerSesionActual();

const normalizarRol = (valor) =>
  String(valor || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letra) => letra.toUpperCase());

if (sesionActual) {
  const nombre = sesionActual.usuario || 'usuario';
  document.getElementById('nombre-usuario-dashboard')?.replaceChildren(document.createTextNode(nombre));
  document
    .getElementById('rol-usuario-dashboard')
    ?.replaceChildren(document.createTextNode(normalizarRol(sesionActual.rol)));
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

const ICONOS_ALERTA = {
  sobrecapacidad: '🔴',
  promedio: '🟠',
  horometro_irregular: '🟡',
  inspeccion_pendiente: '🟣'
};

function descripcionAlerta(tipo) {
  switch (tipo) {
    case 'promedio':
      return 'Consumo superior al promedio';
    case 'horometro_irregular':
      return 'Horómetro irregular';
    case 'inspeccion_pendiente':
      return 'Inspección pendiente';
    default:
      return 'Sobre capacidad detectada';
  }
}

// Reutiliza el mismo listado de /api/alertas para el contador del panel de
// KPIs y para la mini-lista "Alertas recientes" del inicio.
async function cargarAlertasRecientes() {
  const tarjeta = document.getElementById('tarjeta-alertas-recientes');
  if (!sesionActual || typeof usuarioTienePermiso !== 'function' || !usuarioTienePermiso('alertas')) {
    if (tarjeta) tarjeta.hidden = true;
    return;
  }

  try {
    const respuesta = await fetch('/api/alertas', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const alertas = await respuesta.json();
    const pendientes = alertas.filter((alerta) => alerta.estado !== 'justificada');

    document.getElementById('dashboard-alertas')?.replaceChildren(document.createTextNode(String(pendientes.length)));

    const lista = document.getElementById('lista-alertas-recientes');
    if (lista) {
      lista.innerHTML = '';
      pendientes.slice(0, 3).forEach((alerta) => {
        const tipo = alerta.tipo_alerta || 'sobrecapacidad';
        const item = document.createElement('div');
        item.className = `alerta-reciente-item tipo-${tipo}`;
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

    const vacio = document.getElementById('alertas-recientes-vacio');
    if (vacio) vacio.hidden = pendientes.length > 0;
  } catch (error) {
    console.warn('No se pudieron cargar las alertas recientes', error);
  }
}

async function cargarResumen() {
  try {
    const respuesta = await fetch('/api/registros', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const registros = await respuesta.json();

    const hoy = new Date().toISOString().slice(0, 10);
    const delDia = registros.filter((r) => String(r.fecha || '').slice(0, 10) === hoy && !Number(r.cierreDia));
    const galonesHoy = delDia.reduce((total, r) => total + Number(r.cantidad || 0), 0);

    document
      .getElementById('dashboard-galones')
      ?.replaceChildren(document.createTextNode(`${galonesHoy.toFixed(2)} GAL`));
    document.getElementById('dashboard-registros')?.replaceChildren(document.createTextNode(String(delDia.length)));

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

  const mesActual = new Date().toISOString().slice(0, 7);
  const totalesPorMaquina = new Map();

  registros
    .filter((r) => !Number(r.cierreDia) && String(r.fecha || '').slice(0, 7) === mesActual)
    .forEach((r) => {
      const nombre = String(r.maquina || 'Sin máquina').trim() || 'Sin máquina';
      totalesPorMaquina.set(nombre, (totalesPorMaquina.get(nombre) || 0) + Number(r.cantidad || 0));
    });

  const ranking = Array.from(totalesPorMaquina.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (!ranking.length) {
    contenedor.innerHTML = '';
    if (vacio) vacio.hidden = false;
    return;
  }
  if (vacio) vacio.hidden = true;

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
function dibujarConsumoSemana(registros) {
  const grafica = document.getElementById('grafica-consumo-semana');
  const vacio = document.getElementById('grafica-consumo-vacia');
  if (!grafica) return;

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
}

async function cargarConteoMaquinas() {
  const destino = document.getElementById('dashboard-maquinas');
  if (!destino) return;
  try {
    const respuesta = await fetch('/api/tractores?selector=1', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const maquinas = await respuesta.json();
    destino.textContent = String(maquinas.length);
  } catch (error) {
    console.warn('No se pudo cargar el total de máquinas', error);
  }
}

cargarAlertasRecientes();
cargarResumen();
cargarConteoMaquinas();
setInterval(cargarAlertasRecientes, 15000);
setInterval(cargarResumen, 30000);
