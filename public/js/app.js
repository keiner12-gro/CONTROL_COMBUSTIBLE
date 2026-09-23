// ============================================================================
// app.js — FORMULARIO DE REGISTRO DE SUMINISTRO (public/html/index.html)
// ----------------------------------------------------------------------------
// Es la pantalla principal de operación y el archivo más grande del frontend.
// Se encarga de:
//   1. Lecturas de los medidores M1/M2 (apertura automática desde el cierre
//      del día anterior, cálculo de galones y guardado del cierre diario).
//      Esto es ÚNICO por día: solo hay un juego de estos campos en la página.
//   2. DOS asistentes de registro idénticos e independientes ("Puesto 1" y
//      "Puesto 2", sufijos -1/-2 en el HTML): una sola persona puede dejar
//      el Puesto 1 a medio llenar (p. ej. mientras esa manguera sigue
//      despachando) y atender el Puesto 2 sin perder lo que llevaba en el
//      primero. Cada uno guarda su propio registro por separado; el de abajo
//      no espera al de arriba. Toda esa lógica vive en crearPuestoRegistro()
//      y se instancia dos veces al final de este archivo.
//   3. Firma del operario: el lienzo (canvas) es UNO SOLO y lo comparten los
//      dos puestos (se abre para el que lo pidió); ver "instanciaFirmaActiva".
//   4. Envío del registro al servidor y validaciones previas.
// PARA AGREGAR UN TERCER PUESTO: duplica un bloque <section class="flujo-
// registro" id="flujo-registro-N"> en index.html con sufijo -N, y agrega
// `crearPuestoRegistro('N', 'Puesto N');` junto a las otras dos llamadas.
// ============================================================================

// --- Referencias a los elementos COMPARTIDOS (uno solo en toda la página) ---
const fecha = document.getElementById('fecha');
// Medidores: cada manguera del SURTIDOR (M1 y M2) tiene lectura inicial y final.
// (Esto es el control diario del tanque, no tiene relación con los "puestos"
// de registro de suministro descritos arriba.)
const m1Inicial = document.getElementById('m1-inicial');
const m1Final = document.getElementById('m1-final');
const m2Inicial = document.getElementById('m2-inicial');
const m2Final = document.getElementById('m2-final');
const galonesM1 = document.getElementById('galones-m1'); // Resultado calculado M1
const galonesM2 = document.getElementById('galones-m2'); // Resultado calculado M2
const totalGalones = document.getElementById('galones-total'); // Suma de ambos
const botonGuardarCierreDia = document.getElementById('boton-guardar-cierre-dia');
// Firma: lienzo único compartido por los dos puestos (ver instanciaFirmaActiva).
const fondoFirma = document.getElementById('fondo-firma');
const lienzoFirma = document.getElementById('lienzo-firma');
const botonLimpiarFirma = document.getElementById('boton-limpiar-firma');
const botonCerrarFirma = document.getElementById('boton-cerrar-firma');
const botonGuardarFirma = document.getElementById('boton-guardar-firma');
// Tabla de lo registrado durante esta sesión (no es el historial completo):
// la comparten los dos puestos, cada uno agrega sus propias filas.
const tablaRegistros = document.getElementById('tabla-registros');
const resumenTotalPantalla = document.getElementById('resumen-total');
const fechaEncabezado = document.getElementById('fecha-encabezado') || document.querySelector('[data-fecha-encabezado]');

// --- Variables de estado compartido ------------------------------------------
let totalSuministrado = 0; // Acumulado de galones registrados en esta sesión (los dos puestos suman aquí)
let estaFirmando = false; // ¿El dedo/mouse está presionado sobre el lienzo?
let firmaDibujada = false; // ¿Hay algún trazo dibujado en el lienzo compartido?
let cierreDiaGuardado = false; // ¿El cierre del día ya se envió al servidor?
let instanciaFirmaActiva = null; // Qué puesto abrió el lienzo de firma por última vez
const dibujoFirma = lienzoFirma.getContext('2d'); // Pincel del canvas
const nombreAlmacenamiento = 'registrosCombustible'; // Clave de la copia local
let tractoresDisponibles = []; // Catálogo de máquinas descargado (compartido por los dos puestos)
let operariosDisponibles = []; // Catálogo de operarios descargado (compartido por los dos puestos)
const instanciasRegistro = []; // Los puestos creados por crearPuestoRegistro(), para refrescarlos juntos

// Apaga el historial/autocompletado del navegador para que solo salgan las opciones del datalist.
function desactivarAutocompletadoNavegador() {
  document.querySelectorAll('form, input').forEach((elemento) => {
    elemento.setAttribute('autocomplete', 'off');
  });
}

// Lee el valor seleccionado en un grupo de radios del checklist.
function obtenerValorChequeo(nombreCampo) {
  const opcionSeleccionada = document.querySelector(`input[name="${nombreCampo}"]:checked`);
  return opcionSeleccionada ? opcionSeleccionada.value : '';
}

// Verifica si el operario ya lleno las lecturas finales para poder cerrar sesion desde Registro.
function lecturasFinalesCompletas() { return m1Final.value !== '' || m2Final.value !== ''; }
function hayLecturaM1() { return m1Inicial.value !== '' || m1Final.value !== ''; }
function hayLecturaM2() { return m2Inicial.value !== '' || m2Final.value !== ''; }

// Carga las lecturas iniciales según el estado real del día anterior.
// Si existe un cierre del día anterior, cada manguera toma su final y queda bloqueada.
// Si NO existen registros de cierre del día anterior, el inicial queda editable manualmente.
async function cargarLecturasInicialesDesdeUltimoCierre() {
  const fechaSeleccionada = fecha.value;
  if (!fechaSeleccionada) return;

  try {
    const respuesta = await fetch(`/api/cierre-dia/estado?fecha=${encodeURIComponent(fechaSeleccionada)}`, { cache: 'no-store' });
    if (!respuesta.ok) throw new Error('No se pudo consultar el estado del surtidor.');
    const estado = await respuesta.json();

    // Configura una manguera: valor, bloqueo, color y texto explicativo.
    const aplicarManguera = (input, anterior, nombre) => {
      const tieneAnterior = anterior !== null && anterior !== undefined && anterior !== '';
      input.value = tieneAnterior ? Number(anterior).toFixed(2) : '';
      input.readOnly = tieneAnterior; // Si viene del cierre anterior, no se puede cambiar
      input.classList.toggle('inicial-manual', !tieneAnterior);
      input.classList.toggle('inicial-automatico', tieneAnterior);
      const etiqueta = input.parentElement?.querySelector('label span');
      if (etiqueta) etiqueta.textContent = tieneAnterior ? '🔒 Automática desde el cierre anterior' : '✏️ Editable: no hay cierre del día anterior';
      input.title = tieneAnterior ? `Lectura inicial ${nombre} cargada desde el cierre anterior.` : `Lectura inicial ${nombre} editable porque no existe cierre del día anterior.`;
    };

    aplicarManguera(m1Inicial, estado.m1Anterior, 'M1');
    aplicarManguera(m2Inicial, estado.m2Anterior, 'M2');

    // La jornada del día puede estar guardada como BORRADOR (el operario salió de
    // la app y volvió) o como CIERRE definitivo. En ambos casos se restaura
    // lo que el servidor tiene guardado, para que nada se pierda.
    const jornada = estado.jornada;
    const estadoEl = document.getElementById('estado-cierre-surtidor');
    if (jornada) restaurarJornadaEnFormulario(jornada);

    if (jornada && jornada.estado === 'cerrada') {
      // Día cerrado: lecturas bloqueadas.
      m1Inicial.readOnly = true;
      m2Inicial.readOnly = true;
      m1Final.readOnly = true;
      m2Final.readOnly = true;
      cierreDiaGuardado = true;
      if (estadoEl) { estadoEl.textContent = 'Guardado'; estadoEl.className = 'badge-estado-surtidor correcto'; }
    } else {
      // Día abierto: las lecturas finales se pueden capturar.
      m1Final.readOnly = false;
      m2Final.readOnly = false;
      cierreDiaGuardado = false;
      if (estadoEl) {
        estadoEl.textContent = jornada ? 'En curso · guardado' : (estado.hayRegistrosDiaAnterior ? 'Sin cierre anterior' : 'Inicial manual');
        estadoEl.className = 'badge-estado-surtidor pendiente';
      }
    }
    // Aviso si el día anterior se quedó sin cerrar (sus lecturas finales no existen).
    mostrarAvisoDiaAnteriorAbierto(estado.anteriorAbierta);
    // Se completa la recuperación: unir lo que quedó pendiente en este equipo y activar el autoguardado.
    if (window.JornadaBorrador) window.JornadaBorrador.alRestaurar(jornada);
    calcularGalones();
  } catch (error) {
    console.error('No se pudo cargar el estado de M1/M2.', error);
    // Sin respuesta del servidor, se permite edición manual para no bloquear el trabajo local.
    m1Inicial.readOnly = false;
    m2Inicial.readOnly = false;
    m1Inicial.classList.add('inicial-manual');
    m2Inicial.classList.add('inicial-manual');
    calcularGalones();
    // Sin conexión: lo que escriba se guarda en este equipo y se sube al volver la señal.
    if (window.JornadaBorrador) window.JornadaBorrador.alFallarLaCarga();
  }
}

// Escribe en el formulario lo que la jornada tiene guardado (inicial, final y checklist).
function restaurarJornadaEnFormulario(jornada) {
  const poner = (input, valor) => {
    if (valor !== null && valor !== undefined && String(valor) !== '') input.value = Number(valor).toFixed(2);
  };
  poner(m1Inicial, jornada.m1Inicial);
  poner(m2Inicial, jornada.m2Inicial);
  poner(m1Final, jornada.m1Final);
  poner(m2Final, jornada.m2Final);
  // Checklist: se marca la opción guardada.
  [['fuga-biodiesel', jornada.fugaBiodiesel], ['sistema-electrico', jornada.sistemaElectrico], ['parada-emergencia', jornada.paradaEmergencia]].forEach(([nombre, valor]) => {
    if (!valor) return;
    const opcion = [...document.querySelectorAll(`input[name="${nombre}"]`)].find((r) => r.value === valor);
    if (opcion) opcion.checked = true;
  });
}

// Si ayer quedó abierto, se avisa arriba del formulario con un enlace para cerrarlo.
function mostrarAvisoDiaAnteriorAbierto(anteriorAbierta) {
  let aviso = document.getElementById('aviso-dia-anterior');
  if (!anteriorAbierta) { if (aviso) aviso.remove(); return; }
  if (!aviso) {
    aviso = document.createElement('div');
    aviso.id = 'aviso-dia-anterior';
    aviso.className = 'aviso-jornada-pendiente';
    const destino = document.querySelector('.control-surtidor');
    destino?.parentNode.insertBefore(aviso, destino);
  }
  aviso.innerHTML = '';
  const texto = document.createElement('span');
  texto.textContent = `⚠ La jornada del ${anteriorAbierta.fecha} quedó sin cerrar, por eso las lecturas iniciales de hoy son manuales. `;
  const enlace = document.createElement('a');
  enlace.href = `/index?fecha=${encodeURIComponent(anteriorAbierta.fecha)}`;
  enlace.textContent = 'Ir a cerrarla';
  aviso.append(texto, enlace);
}

// Si cambian las lecturas finales, se debe volver a guardar el cierre del dia.
function marcarCierrePendiente() {
  cierreDiaGuardado = false;
}

// Al cerrar sesión (auth.js llama a esta función si existe) ya NO se bloquea al
// operario: lo que escribió se guarda en el servidor y podrá continuar al volver.
// Solo se le recuerda que el día sigue abierto y que debe cerrarlo.
window.validarAntesDeCerrarSesion = async function validarAntesDeCerrarSesion() {
  if (window.JornadaBorrador) await window.JornadaBorrador.guardarYa(); // Sube lo pendiente
  const hayLecturasIniciales = m1Inicial.value !== '' || m2Inicial.value !== '';
  if (!hayLecturasIniciales || cierreDiaGuardado) return true; // Nada pendiente

  const pendienteSinSubir = window.JornadaBorrador?.hayCambiosSinSubir();
  const confirmado = await confirmarAccion(
    'La jornada sigue abierta',
    pendienteSinSubir
      ? 'Tus lecturas se guardaron solo en este equipo (sin conexión). Se subirán al volver a entrar con internet. Recuerda cerrar el día.'
      : 'Tus lecturas quedaron guardadas. Podrás continuar cuando vuelvas a entrar, pero recuerda cerrar el día con las lecturas finales.',
    'Salir de todos modos'
  );
  return Boolean(confirmado);
};

// Coloca automaticamente la fecha del dia actual.
// (Se usa la fecha LOCAL del equipo: valueAsDate daría la fecha UTC, que después
// de las 7 p. m. en Colombia ya es "mañana".) Un enlace con ?fecha=AAAA-MM-DD abre
// esa jornada (para cerrar una que quedó pendiente).
const fechaSolicitada = new URLSearchParams(location.search).get('fecha');
fecha.value = /^\d{4}-\d{2}-\d{2}$/.test(fechaSolicitada || '') ? fechaSolicitada : fechaLocalISO();
if (fechaEncabezado) {
  fechaEncabezado.textContent = new Date().toLocaleString('es-CO', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
cargarLecturasInicialesDesdeUltimoCierre();

// Calcula los galones de cada manguera con la resta: final - inicial.
function calcularGalones() {
  const m1Completo = m1Inicial.value !== '' && m1Final.value !== '';
  const m2Completo = m2Inicial.value !== '' && m2Final.value !== '';
  let totalM1 = 0;
  let totalM2 = 0;

  if (m1Completo) {
    // Se multiplica por 100 y se redondea para evitar los errores de decimales
    // propios de JavaScript (0.1 + 0.2 = 0.30000000000000004).
    const inicialM1 = Math.round((Number(m1Inicial.value) || 0) * 100);
    const finalM1 = Math.round((Number(m1Final.value) || 0) * 100);
    totalM1 = (finalM1 - inicialM1) / 100;
    galonesM1.textContent = totalM1.toFixed(2);
  } else {
    galonesM1.textContent = '—'; // Sin datos suficientes
  }

  if (m2Completo) {
    const inicialM2 = Math.round((Number(m2Inicial.value) || 0) * 100);
    const finalM2 = Math.round((Number(m2Final.value) || 0) * 100);
    totalM2 = (finalM2 - inicialM2) / 100;
    galonesM2.textContent = totalM2.toFixed(2);
  } else {
    galonesM2.textContent = '—';
  }

  totalGalones.textContent = (m1Completo || m2Completo) ? (totalM1 + totalM2).toFixed(2) : '—';
  actualizarEstadoMangueras(); // Refresca los mensajes de validación
}

// Mensaje de validación bajo cada manguera: sin movimiento / pendiente /
// error (final menor que inicial) / lectura válida.
function actualizarEstadoMangueras(){
  [{i:m1Inicial,f:m1Final,g:galonesM1,e:document.getElementById('validacion-m1')},{i:m2Inicial,f:m2Final,g:galonesM2,e:document.getElementById('validacion-m2')}].forEach(x=>{if(!x.e)return;if(!x.i.value&&!x.f.value){x.e.textContent='Sin movimiento registrado.';x.e.className='validacion-manguera neutra';return;}if(!x.f.value){x.e.textContent='Pendiente: ingresa la lectura final.';x.e.className='validacion-manguera pendiente';return;}if(Number(x.f.value)<Number(x.i.value)){x.e.textContent='⚠️ La lectura final no puede ser menor que la inicial.';x.e.className='validacion-manguera error';return;}x.e.textContent=Number(x.g.value||0)===0?'Sin movimiento.':'✓ Lectura válida.';x.e.className='validacion-manguera correcta';});
}

// --- Catálogos (compartidos por los dos puestos) -----------------------------

// Carga los operarios desde el servidor y refresca la lista en los dos puestos.
async function cargarOperariosEnFormulario() {
  operariosDisponibles = [];

  try {
    // ?selector=1 indica al backend que basta con el permiso 'registro'.
    const respuesta = await fetch('/api/operarios?selector=1', {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    const datos = await respuesta.json();
    operariosDisponibles = Array.isArray(datos) ? datos : [];

    if (!operariosDisponibles.length) console.warn('No hay operarios disponibles.');
    instanciasRegistro.forEach((instancia) => instancia.renderizarOperarios(operariosDisponibles));
  } catch (error) {
    console.error('No se pudieron cargar los operarios desde MySQL.', error);
    operariosDisponibles = [];
  }
}

// Carga los tractores desde el servidor y refresca el selector en los dos puestos.
async function cargarTractoresEnFormulario() {
  tractoresDisponibles = [];

  try {
    const respuesta = await fetch('/api/tractores?selector=1', {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });

    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    const datos = await respuesta.json();
    tractoresDisponibles = Array.isArray(datos) ? datos : [];

    instanciasRegistro.forEach((instancia) => instancia.renderizarMaquinas(tractoresDisponibles));
  } catch (error) {
    console.error('No se pudieron cargar las máquinas desde MySQL.', error);
    tractoresDisponibles = [];
    instanciasRegistro.forEach((instancia) => {
      instancia.contenedorMaquinas.innerHTML = '<div class="estado-vacio-selector">No se pudieron cargar las máquinas. Verifica que el servidor esté conectado a MySQL.</div>';
    });
  }
}

// Identifica solo el Tanque Movil que esta creado en tractores con item 73 e id 198.
// Se comprueba por id, por ítem y por nombre para que siga funcionando aunque
// el registro cambie de identificador en la base de datos. (Pura: la usan los dos puestos.)
function esTanqueMovil(tractor) {
  if (!tractor) {
    return false;
  }

  const nombreMaquina = String(tractor.maquina || '').trim().toLowerCase();
  const descripcion = String(tractor.descripcion || '').trim().toLowerCase();

  return Number(tractor.id) === 198
    || Number(tractor.item) === 73
    || nombreMaquina === 'tanque movil'
    || descripcion === 'tanque movil';
}

// Normaliza el texto del buscador de máquinas: sin acentos, sin signos y en
// minúsculas, para que "MA-05", "ma 05" y "ma05" se consideren iguales. (Pura.)
function normalizarBusquedaMaquina(valor){
  return String(valor||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

// ===========================================================================
// BLOQUE DE LA FIRMA (canvas único, compartido por los dos puestos)
// La firma se dibuja con el dedo o el mouse y se guarda como imagen PNG en
// base64 dentro del campo oculto del puesto que abrió el lienzo
// (instanciaFirmaActiva, fijada por cada puesto en su botón "Firmar").
// ===========================================================================

// Prepara el lienzo blanco donde el operario firma.
function prepararLienzoFirma() {
  dibujoFirma.lineWidth = 3; // Grosor del trazo
  dibujoFirma.lineCap = 'round'; // Puntas redondeadas
  dibujoFirma.strokeStyle = '#111719'; // Color de la tinta
}

// Convierte la posición del puntero en pantalla a coordenadas internas del
// canvas (necesario porque el lienzo se muestra escalado por CSS).
function obtenerPosicionFirma(evento) {
  const tamanoLienzo = lienzoFirma.getBoundingClientRect();

  return {
    x: (evento.clientX - tamanoLienzo.left) * (lienzoFirma.width / tamanoLienzo.width),
    y: (evento.clientY - tamanoLienzo.top) * (lienzoFirma.height / tamanoLienzo.height)
  };
}

// Al presionar: comienza un trazo nuevo.
function iniciarFirma(evento) {
  estaFirmando = true;
  firmaDibujada = true;
  dibujoFirma.beginPath();

  const posicion = obtenerPosicionFirma(evento);
  dibujoFirma.moveTo(posicion.x, posicion.y);
}

// Al mover con el puntero presionado: se extiende la línea.
function dibujarFirma(evento) {
  if (!estaFirmando) {
    return;
  }

  const posicion = obtenerPosicionFirma(evento);
  dibujoFirma.lineTo(posicion.x, posicion.y);
  dibujoFirma.stroke();
}

// Al soltar o salir del lienzo: termina el trazo.
function terminarFirma() {
  estaFirmando = false;
}

// Borra el lienzo y descarta la firma guardada del puesto indicado (o del que
// tenga abierto el lienzo, si no se indica ninguno).
function limpiarFirma(instancia) {
  dibujoFirma.clearRect(0, 0, lienzoFirma.width, lienzoFirma.height);
  firmaDibujada = false;
  const objetivo = instancia || instanciaFirmaActiva;
  if (objetivo) {
    objetivo.firmaOperario.value = '';
    objetivo.botonAbrirFirma.textContent = 'Firma';
  }
}

// --- Guardado de registros (compartido: lo usan los dos puestos) -----------

// Lee la copia local de registros del navegador.
function obtenerRegistrosGuardados() {
  try {
    return JSON.parse(localStorage.getItem(nombreAlmacenamiento)) || [];
  } catch (error) {
    return []; // Dato dañado o almacenamiento bloqueado
  }
}

// Guarda una copia local si se abre el HTML sin usar Node.
function guardarRegistroLocal(registro) {
  // La copia es solo un respaldo: nunca debe impedir ni "romper" un guardado que
  // ya se hizo en el servidor. Sin la firma (pesada) y con tope de 50 registros
  // para no llenar el almacenamiento del navegador.
  try {
    const { firma, ...sinFirma } = registro;
    const registros = obtenerRegistrosGuardados();
    registros.push(sinFirma);
    localStorage.setItem(nombreAlmacenamiento, JSON.stringify(registros.slice(-50)));
  } catch (error) {
    console.warn('No se pudo guardar la copia local del registro.', error);
  }
}

// Envia el registro al servidor Node para guardarlo en data/registros.json.
// (Hoy el destino real es la tabla registros_combustible de MySQL/Airtable.)
async function guardarRegistroServidor(registro) {
  const respuesta = await fetch('/api/registros', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(registro)
  });

  if (!respuesta.ok) {
    const errorServidor = await respuesta.json();
    throw new Error(errorServidor.mensaje || 'No se pudo guardar el registro en el servidor.');
  }

  return respuesta.json();
}

// Guarda solo el cierre final de las mangueras sin enviar el formulario de suministro.
async function guardarCierreDiaServidor(registro) {
  const respuesta = await fetch('/api/cierre-dia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(registro)
  });

  if (!respuesta.ok) {
    const errorServidor = await respuesta.json();
    throw new Error(errorServidor.mensaje || 'No se pudo guardar el cierre del dia.');
  }

  return respuesta.json();
}

// Trae registros existentes para validar el ultimo horometro de la maquina.
// Si el servidor no responde, se usa la copia local del navegador.
async function obtenerRegistrosParaValidar() {
  try {
    const respuesta = await fetch('/api/registros');

    if (!respuesta.ok) {
      return obtenerRegistrosGuardados();
    }

    return respuesta.json();
  } catch (error) {
    return obtenerRegistrosGuardados();
  }
}

// Busca el mayor horometro numerico guardado para una maquina.
// Los horómetros con texto ("dañado") se descartan con Number.isFinite.
function obtenerUltimoHorometroMaquina(registros, nombreMaquina) {
  return registros
    .filter((registro) => registro.maquina === nombreMaquina)
    .map((registro) => Number(String(registro.horometro || '').replace(',', '.')))
    .filter((valor) => Number.isFinite(valor))
    .reduce((mayor, valor) => Math.max(mayor, valor), 0);
}

// Capacidad del tanque de una máquina (comparación sin distinguir mayúsculas).
async function obtenerCapacidadMaquina(nombreMaquina) {
  try {
    const respuesta = await fetch('/api/tractores');
    const tractores = await respuesta.json();
    const tractor = tractores.find((item) => String(item.maquina || '').toUpperCase() === String(nombreMaquina || '').toUpperCase());
    return Number(tractor?.capacidad_galones ?? tractor?.capacidad ?? 0) || 0;
  } catch (error) {
    return 0; // Sin dato: no se puede comparar capacidad
  }
}

// Valida los datos obligatorios antes de permitir guardar el suministro.
// Son las mismas reglas que aplica el servidor; aquí se adelantan para dar
// una respuesta inmediata al usuario. La usan los dos puestos por igual.
async function validarRegistroAntesDeGuardar(registro) {
  if (!registro.m1Inicial && !registro.m2Inicial) {
    await mostrarAlertaError('Faltan lecturas iniciales', 'Debes tener al menos una lectura inicial disponible para continuar.');
    return false;
  }

  if (!registro.firma) {
    await mostrarAlertaError('Firma obligatoria', 'Debes guardar la firma del operario antes de registrar.');
    return false;
  }

  // El horómetro nunca puede retroceder respecto al último registrado.
  const horometroNuevo = Number(String(registro.horometro || '').replace(',', '.'));

  if (Number.isFinite(horometroNuevo)) {
    const registros = await obtenerRegistrosParaValidar();
    const ultimoHorometro = obtenerUltimoHorometroMaquina(registros, registro.maquina);

    if (ultimoHorometro && horometroNuevo < ultimoHorometro) {
      await mostrarAlertaError(
        'Horometro menor',
        `El horometro no puede ser menor al ultimo registrado para ${registro.maquina}: ${ultimoHorometro}.`
      );
      return false;
    }
  }

  return true;
}

// ===========================================================================
// UN PUESTO DE REGISTRO COMPLETO (máquina -> operario -> suministro -> confirmar)
// Todo lo de aquí adentro es privado a CADA puesto: su propio estado, sus
// propios elementos (buscados por id con el sufijo) y sus propios listeners.
// Lo único que comparten los dos puestos son las variables/funciones de
// arriba (catálogos, medidores M1/M2, lienzo de firma, tabla de hoy).
// ===========================================================================
function crearPuestoRegistro(sufijo, etiqueta) {
  const el = (id) => document.getElementById(`${id}-${sufijo}`);

  const contenedorInstancia = el('flujo-registro');
  const formulario = el('formulario-control');
  const nombreOperario = el('nombre-operario');
  const cedulaOperario = el('cedula-operario');
  const maquina = el('maquina');
  const tractorDescripcion = el('tractor-descripcion');
  const tractorCentroCosto = el('tractor-centro-costo');
  const horometro = el('horometro');
  const cantidad = el('cantidad');
  const numeroSai = el('no-sai');
  const observaciones = el('observaciones');
  const firmaOperario = el('firma-operario');
  const botonAbrirFirma = el('boton-abrir-firma');
  const contenedorMaquinas = el('selector-maquinas-cards');
  const contenedorOperarios = el('selector-operarios-cards');
  const buscadorMaquina = el('maquina-busqueda');
  const buscadorOperario = el('operario-busqueda');
  const resumenMaquinaSeleccionada = el('resumen-maquina-seleccionada');
  const resumenOperarioSeleccionado = el('resumen-operario-seleccionado');
  const miniMaquina = el('mini-maquina');
  const miniOperario = el('mini-operario');
  const indicadorCapacidad = el('indicador-capacidad');
  const confirmacionRegistro = el('confirmacion-registro');

  const api = { firmaOperario, botonAbrirFirma, renderizarMaquinas, renderizarOperarios, contenedorMaquinas };

  // Muestra los datos del tractor seleccionado sin modificar registros historicos.
  function mostrarDatosTractorSeleccionado() {
    const tractorSeleccionado = tractoresDisponibles.find((tractor) => tractor.maquina === maquina.value);

    // Descripción y centro de costo se llenan solos: son informativos.
    tractorDescripcion.value = tractorSeleccionado ? tractorSeleccionado.descripcion : '';
    tractorCentroCosto.value = tractorSeleccionado ? tractorSeleccionado.centro_costo : '';
    if (resumenMaquinaSeleccionada) {
      resumenMaquinaSeleccionada.hidden = !tractorSeleccionado;
      if (tractorSeleccionado) resumenMaquinaSeleccionada.innerHTML = `✓ <strong>${escapeHtml(tractorSeleccionado.maquina)}</strong> · ${escapeHtml(tractorSeleccionado.descripcion || 'Sin descripción')} · Tanque ${Number(tractorSeleccionado.capacidad_galones || tractorSeleccionado.capacidad || 0).toFixed(2)} gal`;
    }
    actualizarIndicadorCapacidad();

    // El tanque movil no maneja horometro, por eso se llena automaticamente como N/A.
    if (esTanqueMovil(tractorSeleccionado)) {
      horometro.value = 'N/A';
      return;
    }

    // Si se cambia del tanque móvil a otra máquina, se limpia el "N/A".
    if (horometro.value === 'N/A') {
      horometro.value = '';
    }
  }

  // Muestra la cedula del operario seleccionado sin modificar registros historicos.
  function mostrarDatosOperarioSeleccionado() {
    const operarioSeleccionado = operariosDisponibles.find((operario) => operario.nombre === nombreOperario.value);
    cedulaOperario.value = operarioSeleccionado ? operarioSeleccionado.cedula : '';
  }

  // Dibuja las tarjetas del selector de máquinas, filtradas por el buscador.
  // La normalización (NFD + quitar acentos + minúsculas) permite encontrar
  // "MÁQUINA" escribiendo "maquina".
  function renderizarMaquinas(lista, filtro = '') {
    if (!contenedorMaquinas) return;
    const q = String(filtro || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    contenedorMaquinas.innerHTML = '';
    // Se busca en código, descripción y centro de costo a la vez.
    const visibles = lista.filter(t => `${t.maquina || ''} ${t.descripcion || ''} ${t.centro_costo || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q));
    if (!visibles.length) { contenedorMaquinas.innerHTML = '<div class="estado-vacio-selector">No se encontraron máquinas.</div>'; return; }
    // Cada tarjeta muestra código, descripción y capacidad del tanque; al pulsarla
    // se fija la máquina y se vuelve a dibujar la lista para marcar la elegida.
    visibles.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `selector-card ${normalizarBusquedaMaquina(maquina.value) === normalizarBusquedaMaquina(t.maquina) ? 'seleccionada' : ''}`;
      b.innerHTML = `<span class="selector-card-icon">🚜</span><span><strong>${escapeHtml(t.maquina)}</strong><small>${escapeHtml(t.descripcion || 'Sin descripción')}</small><em>Tanque: ${Number(t.capacidad_galones || t.capacidad || 0).toFixed(2)} gal</em></span><b>→</b>`;
      b.onclick = () => { maquina.value = t.maquina; mostrarDatosTractorSeleccionado(); renderizarMaquinas(tractoresDisponibles, buscadorMaquina?.value); };
      contenedorMaquinas.appendChild(b);
    });
  }

  // Mismo mecanismo para el selector de operarios (busca por nombre o cédula).
  // Al elegir uno se llena también automáticamente la cédula.
  function renderizarOperarios(lista, filtro = '') {
    if (!contenedorOperarios) return;
    const q = String(filtro || '').toLowerCase().trim();
    contenedorOperarios.innerHTML = '';
    const visibles = lista.filter(o => `${o.nombre || ''} ${o.cedula || ''}`.toLowerCase().includes(q));
    if (!visibles.length) { contenedorOperarios.innerHTML = '<div class="estado-vacio-selector">No se encontraron operarios.</div>'; return; }
    visibles.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `selector-card ${nombreOperario.value === o.nombre ? 'seleccionada' : ''}`;
      b.innerHTML = `<span class="selector-card-icon">👤</span><span><strong>${escapeHtml(o.nombre)}</strong><small>Operario</small><em>Cédula: ${escapeHtml(o.cedula || '—')}</em></span><b>→</b>`;
      b.onclick = () => { nombreOperario.value = o.nombre; cedulaOperario.value = o.cedula || ''; mostrarDatosOperarioSeleccionado(); renderizarOperarios(operariosDisponibles, buscadorOperario?.value); };
      contenedorOperarios.appendChild(b);
    });
  }

  // Resumen del paso 4: máquina, operario, cantidad y soporte antes de guardar.
  function actualizarConfirmacion() {
    if (!confirmacionRegistro) return;
    const t = tractoresDisponibles.find(x => normalizarBusquedaMaquina(x.maquina) === normalizarBusquedaMaquina(maquina.value));
    confirmacionRegistro.innerHTML = `<div class="confirmacion-linea"><span>🚜</span><div><small>Máquina</small><strong>${escapeHtml(maquina.value || '—')}</strong><em>${escapeHtml(t?.descripcion || tractorDescripcion.value || '')}</em></div></div><div class="confirmacion-linea"><span>👤</span><div><small>Operario</small><strong>${escapeHtml(nombreOperario.value || '—')}</strong><em>Cédula: ${escapeHtml(cedulaOperario.value || '—')}</em></div></div><div class="confirmacion-linea"><span>⛽</span><div><small>Cantidad</small><strong>${Number(cantidad.value || 0).toFixed(2)} GAL</strong><em>Horómetro: ${escapeHtml(horometro.value || '—')}</em></div></div><div class="confirmacion-linea"><span>📄</span><div><small>Soporte</small><strong>${escapeHtml(numeroSai.value || 'Sin SAI')}</strong><em>${firmaOperario.value ? '✓ Firma guardada' : '⚠ Falta firma'}</em></div></div>`;
  }

  // Aviso en vivo mientras se escribe la cantidad: verde (normal), naranja
  // (>=85% del tanque) o rojo (excede la capacidad). El exceso NO impide guardar:
  // se permite y el servidor genera la alerta de sobrecapacidad.
  function actualizarIndicadorCapacidad() {
    if (!indicadorCapacidad) return;
    const t = tractoresDisponibles.find(x => normalizarBusquedaMaquina(x.maquina) === normalizarBusquedaMaquina(maquina.value));
    const cap = Number(t?.capacidad_galones || t?.capacidad || 0);
    const v = Number(cantidad.value || 0);
    if (!cap) { indicadorCapacidad.hidden = true; return; }
    const pct = v / cap * 100;
    indicadorCapacidad.hidden = false;
    indicadorCapacidad.className = `indicador-capacidad ${v > cap ? 'exceso' : pct >= 85 ? 'advertencia' : 'normal'}`;
    indicadorCapacidad.innerHTML = v > cap ? `⚠️ <strong>Sobrecapacidad</strong> · Tanque ${cap.toFixed(2)} gal · Suministro ${v.toFixed(2)} gal · Exceso ${(v - cap).toFixed(2)} gal. Se permitirá guardar y se generará una alerta.` : `<strong>${Math.min(pct, 100).toFixed(1)}%</strong> de la capacidad · Tanque ${cap.toFixed(2)} gal`;
  }

  // Navega entre los pasos de ESTE asistente: muestra el paso pedido, actualiza
  // los indicadores de progreso y prepara el contenido de los pasos 3 y 4.
  function irAPaso(numero) {
    contenedorInstancia.querySelectorAll('.paso-formulario').forEach(p => p.classList.toggle('activo', Number(p.dataset.paso) === numero));
    contenedorInstancia.querySelectorAll('[data-paso-indicador]').forEach(i => {
      const n = Number(i.dataset.pasoIndicador);
      i.classList.toggle('activo', n === numero);
      i.classList.toggle('completado', n < numero);
    });
    if (numero === 3) {
      if (miniMaquina) miniMaquina.textContent = `🚜 ${maquina.value || 'Máquina'}`;
      if (miniOperario) miniOperario.textContent = `👤 ${nombreOperario.value || 'Operario'}`;
      actualizarIndicadorCapacidad();
    }
    if (numero === 4) actualizarConfirmacion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Requisitos para poder avanzar: paso 1 máquina, paso 2 operario con cédula,
  // paso 3 cantidad mayor que cero y firma guardada.
  function validarPaso(numero) {
    if (numero === 1 && !maquina.value) { mostrarAlertaError('Selecciona una máquina', 'Elige una máquina para continuar.'); return false; }
    if (numero === 2 && (!nombreOperario.value || !cedulaOperario.value)) { mostrarAlertaError('Selecciona un operario', 'Elige quién realiza el suministro.'); return false; }
    if (numero === 3) {
      if (!cantidad.value || Number(cantidad.value) <= 0) { mostrarAlertaError('Cantidad requerida', 'Ingresa la cantidad de galones suministrados.'); return false; }
      if (!firmaOperario.value) { mostrarAlertaError('Firma requerida', 'Debes guardar la firma antes de confirmar.'); return false; }
    }
    return true;
  }

  // Selecciona la máquina que coincida con lo escrito (primero exacta, luego parcial).
  function seleccionarMaquinaDesdeBusqueda(valor) {
    const q = normalizarBusquedaMaquina(valor);
    if (!q) return false;
    const tractor = tractoresDisponibles.find(t => normalizarBusquedaMaquina(t.maquina) === q)
      || tractoresDisponibles.find(t => normalizarBusquedaMaquina(t.maquina).includes(q));
    if (!tractor) return false;
    maquina.value = tractor.maquina;
    mostrarDatosTractorSeleccionado();
    renderizarMaquinas(tractoresDisponibles, valor);
    if (buscadorMaquina) buscadorMaquina.value = tractor.maquina; // Completa el texto con el código real
    return true;
  }

  // --- Eventos de este puesto ---
  maquina.addEventListener('change', mostrarDatosTractorSeleccionado);
  maquina.addEventListener('input', mostrarDatosTractorSeleccionado);
  nombreOperario.addEventListener('change', mostrarDatosOperarioSeleccionado);
  nombreOperario.addEventListener('input', mostrarDatosOperarioSeleccionado);
  cantidad.addEventListener('input', actualizarIndicadorCapacidad);

  // Botón "Firmar": este puesto pasa a ser el dueño del lienzo compartido.
  botonAbrirFirma.addEventListener('click', () => {
    instanciaFirmaActiva = api;
    dibujoFirma.clearRect(0, 0, lienzoFirma.width, lienzoFirma.height);
    firmaDibujada = false;
    fondoFirma.hidden = false;
  });

  // Buscador de máquinas: filtra al escribir y, si el texto coincide exactamente
  // con una máquina, la selecciona sola.
  buscadorMaquina?.addEventListener('input', e => {
    renderizarMaquinas(tractoresDisponibles, e.target.value);
    const exacta = tractoresDisponibles.find(t => normalizarBusquedaMaquina(t.maquina) === normalizarBusquedaMaquina(e.target.value));
    if (exacta) {
      maquina.value = exacta.maquina;
      mostrarDatosTractorSeleccionado();
      renderizarMaquinas(tractoresDisponibles, e.target.value);
    }
  });
  // Enter en el buscador: selecciona la coincidencia o avisa que no existe.
  buscadorMaquina?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Evita que Enter envíe el formulario
      if (!seleccionarMaquinaDesdeBusqueda(e.currentTarget.value)) {
        mostrarAlertaError('Máquina no encontrada', 'No hay una máquina registrada que coincida con esa búsqueda. Verifica el código o la descripción.');
      }
    }
  });
  // Buscador de operarios (solo filtra la lista).
  buscadorOperario?.addEventListener('input', e => renderizarOperarios(operariosDisponibles, e.target.value));

  // Botones "Siguiente" (validan antes de avanzar) y "Anterior", solo los de este puesto.
  contenedorInstancia.querySelectorAll('.boton-siguiente').forEach(b => b.addEventListener('click', () => {
    const n = Number(b.closest('.paso-formulario').dataset.paso);
    if (validarPaso(n)) irAPaso(Number(b.dataset.next));
  }));
  contenedorInstancia.querySelectorAll('.boton-anterior').forEach(b => b.addEventListener('click', () => irAPaso(Number(b.dataset.prev))));

  // --- ENVÍO DEL FORMULARIO: guardar el suministro de este puesto ------------
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    // Se arma el objeto con todos los datos del registro.
    const fila = document.createElement('tr');
    const registro = {
      fecha: fecha.value,
      m1Inicial: m1Inicial.value,
      m1Final: m1Final.value,
      m2Inicial: m2Inicial.value,
      m2Final: m2Final.value,
      galonesM1: galonesM1.value,
      galonesM2: galonesM2.value,
      totalGalones: totalGalones.value,
      fugaBiodiesel: obtenerValorChequeo('fuga-biodiesel'),
      sistemaElectrico: obtenerValorChequeo('sistema-electrico'),
      paradaEmergencia: obtenerValorChequeo('parada-emergencia'),
      cierreDia: false, // Este NO es un cierre de día, es un suministro
      operario: nombreOperario.value,
      cedula: cedulaOperario.value,
      maquina: maquina.value,
      horometro: horometro.value,
      cantidad: cantidad.value,
      numeroSai: numeroSai.value,
      firma: firmaOperario.value,
      observaciones: observaciones.value,
      registradoEn: new Date().toISOString()
    };

    // Si alguna validación falla, no se envía nada.
    if (!(await validarRegistroAntesDeGuardar(registro))) {
      return;
    }

    // Estos datos se guardan en el mismo orden de las columnas de la tabla.
    const datos = [
      registro.operario,
      registro.cedula,
      registro.maquina,
      registro.horometro,
      registro.cantidad,
      registro.numeroSai
    ];

    // Crea una celda por cada dato y la agrega a la fila.
    datos.forEach((dato) => {
      const celda = document.createElement('td');
      celda.textContent = dato;
      fila.appendChild(celda);
    });

    // Celda de la firma: se muestra la imagen en miniatura.
    const celdaFirma = document.createElement('td');

    if (registro.firma) {
      const imagenFirma = document.createElement('img');
      imagenFirma.src = registro.firma;
      imagenFirma.alt = 'Firma del operario';
      imagenFirma.className = 'firma-tabla';
      celdaFirma.appendChild(imagenFirma);
    } else {
      celdaFirma.textContent = 'Sin firma';
    }

    fila.appendChild(celdaFirma);

    const celdaObservaciones = document.createElement('td');
    celdaObservaciones.textContent = registro.observaciones;
    fila.appendChild(celdaObservaciones);

    try {
      const registroGuardado = await guardarRegistroServidor(registro);
      guardarRegistroLocal(registroGuardado); // Copia local
      // El servidor informa si se generó alerta de sobrecapacidad.
      const extra = registroGuardado.alertaSobrecapacidad ? ' Se generó una alerta por sobrecapacidad.' : '';
      await mostrarAlertaExito('✓ Registro guardado', `${Number(registro.cantidad || 0).toFixed(2)} GAL · ${registro.maquina} · ${registro.operario}. Registro #${registroGuardado.id}.${extra}`);
    } catch (error) {
      // Si falla el guardado, la fila NO se agrega a la tabla de pantalla.
      await mostrarAlertaError('No se pudo guardar', error.message);
      return;
    }

    // Se agrega la fila a la tabla COMPARTIDA de la sesión y se actualiza el acumulado.
    tablaRegistros.appendChild(fila);
    totalSuministrado += Number(cantidad.value) || 0;
    resumenTotalPantalla.textContent = totalSuministrado.toFixed(2);

    // Limpia solo los campos de ESTE puesto para ingresar otro registro.
    // Las lecturas de M1/M2 y la fecha se conservan: son del día completo y
    // el otro puesto puede seguir con lo suyo sin que esto lo afecte.
    nombreOperario.value = '';
    cedulaOperario.value = '';
    maquina.value = '';
    tractorDescripcion.value = '';
    tractorCentroCosto.value = '';
    horometro.value = '';
    cantidad.value = '';
    numeroSai.value = '';
    observaciones.value = '';
    limpiarFirma(api);
    nombreOperario.focus();
    // Se redibujan los selectores de ESTE puesto y se vuelve a su primer paso.
    renderizarMaquinas(tractoresDisponibles); renderizarOperarios(operariosDisponibles); irAPaso(1);
  });

  instanciasRegistro.push(api);
  return api;
}

// --- Arranque de la pantalla ------------------------------------------------
desactivarAutocompletadoNavegador();
prepararLienzoFirma();
crearPuestoRegistro('1', 'Puesto 1');
crearPuestoRegistro('2', 'Puesto 2');
cargarOperariosEnFormulario();
cargarTractoresEnFormulario();

// --- Eventos de los medidores (compartidos, un solo M1/M2 por día) ---------
// Cada cambio recalcula los galones y marca el cierre como pendiente de guardar.
m1Inicial.addEventListener('input', calcularGalones);
m1Inicial.addEventListener('input', marcarCierrePendiente);
m1Final.addEventListener('input', calcularGalones);
m1Final.addEventListener('input', marcarCierrePendiente);
m2Inicial.addEventListener('input', calcularGalones);
m2Inicial.addEventListener('input', marcarCierrePendiente);
m2Final.addEventListener('input', calcularGalones);
m2Final.addEventListener('input', marcarCierrePendiente);
// Cambiar la fecha recarga el estado de los medidores de ese día.
fecha.addEventListener('change', cargarLecturasInicialesDesdeUltimoCierre);

// Ventana de firma (compartida): abrir ya lo hace cada puesto en su propio
// botón; aquí solo cerrar, limpiar y guardar sobre el puesto activo.
botonCerrarFirma.addEventListener('click', () => {
  fondoFirma.hidden = true;
});

botonLimpiarFirma.addEventListener('click', () => limpiarFirma());

botonGuardarFirma.addEventListener('click', () => {
  if (!firmaDibujada || !instanciaFirmaActiva) {
    return; // No se guarda un lienzo en blanco
  }

  // toDataURL convierte el dibujo en una imagen PNG en base64.
  instanciaFirmaActiva.firmaOperario.value = lienzoFirma.toDataURL('image/png');
  instanciaFirmaActiva.botonAbrirFirma.textContent = 'Firma guardada';
  fondoFirma.hidden = true;
});

// Guarda el cierre de M1/M2 final sin pedir datos de operario, maquina, firma ni cantidad.
botonGuardarCierreDia.addEventListener('click', async () => {
  // Tres validaciones: al menos una lectura final y que ninguna final sea
  // menor que su inicial.
  if (!lecturasFinalesCompletas()) { await mostrarAlertaError('Faltan datos finales','Ingresa al menos una lectura final: M1, M2 o ambas.'); return; }
  if (hayLecturaM1() && (!m1Inicial.value || !m1Final.value || Number(m1Final.value)<Number(m1Inicial.value))) { await mostrarAlertaError('Revisa M1','La lectura final de M1 debe ser igual o mayor que su inicial.'); return; }
  if (hayLecturaM2() && (!m2Inicial.value || !m2Final.value || Number(m2Final.value)<Number(m2Inicial.value))) { await mostrarAlertaError('Revisa M2','La lectura final de M2 debe ser igual o mayor que su inicial.'); return; }

  // El cierre lleva solo medidores y checklist: nada de operario ni máquina.
  const cierreDia = {
    fecha: fecha.value,
    m1Inicial: m1Inicial.value,
    m1Final: m1Final.value,
    m2Inicial: m2Inicial.value,
    m2Final: m2Final.value,
    galonesM1: galonesM1.value,
    galonesM2: galonesM2.value,
    totalGalones: totalGalones.textContent,
    fugaBiodiesel: obtenerValorChequeo('fuga-biodiesel'),
    sistemaElectrico: obtenerValorChequeo('sistema-electrico'),
    paradaEmergencia: obtenerValorChequeo('parada-emergencia'),
    cierreDia: true,
    registradoEn: new Date().toISOString()
  };

  try {
    await guardarCierreDiaServidor(cierreDia);
    // Guardado con éxito: se bloquean los cuatro campos y se marca el estado.
    cierreDiaGuardado = true; m1Inicial.readOnly=true; m2Inicial.readOnly=true; m1Final.readOnly=true; m2Final.readOnly=true; const estado=document.getElementById('estado-cierre-surtidor'); if(estado){estado.textContent='Guardado';estado.className='badge-estado-surtidor correcto';}
    await mostrarAlertaExito('Cierre guardado','Las lecturas de M1 y M2 quedaron guardadas de forma independiente.');
  } catch (error) {
    await mostrarAlertaError('No se pudo guardar', error.message);
  }
});

// Eventos de puntero del lienzo (funcionan igual con dedo, lápiz o mouse).
lienzoFirma.addEventListener('pointerdown', iniciarFirma);
lienzoFirma.addEventListener('pointermove', dibujarFirma);
lienzoFirma.addEventListener('pointerup', terminarFirma);
lienzoFirma.addEventListener('pointerleave', terminarFirma); // Si sale del área, corta el trazo

actualizarEstadoMangueras();
