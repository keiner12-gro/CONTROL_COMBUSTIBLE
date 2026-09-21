// ============================================================================
// jornada-borrador.js — AUTOGUARDADO DE LAS LECTURAS M1/M2 Y DEL CHECKLIST
// ----------------------------------------------------------------------------
// Problema que resuelve: el operario escribe las lecturas de las mangueras, sale
// de la app (o se le apaga el celular, o entra otra persona más tarde) y al
// volver el formulario aparecía vacío.
// Ahora, mientras escribe:
//   1. Se guarda en el SERVIDOR (PUT /api/jornadas/:fecha) sin pulsar nada.
//   2. Se guarda una copia en ESTE EQUIPO (localStorage) por si no hay señal;
//      se sube sola cuando vuelve la conexión.
//   3. Al cerrar/ocultar la pestaña se fuerza un último guardado.
// Solo se envían los campos que el usuario tocó: así dos personas que trabajan
// el mismo día no se borran lo que cada una escribió.
// Depende de app.js (m1Inicial, fecha, obtenerValorChequeo...), que se carga antes.
// PARA CAMBIAR CADA CUÁNTO SE GUARDA -> ESPERA_GUARDADO_MS.
// ============================================================================

(function () {
  'use strict';

  const ESPERA_GUARDADO_MS = 800; // Pausa al escribir antes de guardar
  const REINTENTO_MS = 15000; // Cada cuánto reintenta si no hay conexión

  // campo del servidor -> cómo leer su valor actual en el formulario
  const LECTORES = {
    m1Inicial: () => m1Inicial.value,
    m1Final: () => m1Final.value,
    m2Inicial: () => m2Inicial.value,
    m2Final: () => m2Final.value,
    fugaBiodiesel: () => obtenerValorChequeo('fuga-biodiesel'),
    sistemaElectrico: () => obtenerValorChequeo('sistema-electrico'),
    paradaEmergencia: () => obtenerValorChequeo('parada-emergencia')
  };
  const NOMBRES_CHECKLIST = {
    fugaBiodiesel: 'fuga-biodiesel',
    sistemaElectrico: 'sistema-electrico',
    paradaEmergencia: 'parada-emergencia'
  };

  const sucios = new Set(); // Campos que el usuario tocó y aún no están en el servidor
  let fechaEdicion = null; // Fecha (jornada) a la que pertenecen los campos sucios
  let listo = false; // ¿Ya se cargó el estado del servidor?
  let cargaFallida = false; // ¿La carga inicial falló (sin conexión)?
  let temporizador = null;
  let reintento = null;
  let enVuelo = null; // Guardado en curso
  let repetir = false; // Hubo cambios mientras se guardaba

  // ---- Indicador visible junto al estado del cierre ----
  function indicador() {
    let el = document.getElementById('estado-borrador');
    if (!el) {
      const insignia = document.getElementById('estado-cierre-surtidor');
      if (!insignia) return null;
      el = document.createElement('small');
      el.id = 'estado-borrador';
      el.className = 'estado-borrador';
      el.setAttribute('role', 'status');
      insignia.insertAdjacentElement('afterend', el);
    }
    return el;
  }
  function mostrar(texto, clase = '') {
    const el = indicador();
    if (!el) return;
    el.textContent = texto;
    el.className = `estado-borrador ${clase}`.trim();
  }
  const hora = (valor) =>
    new Date(valor || Date.now()).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    });

  // ---- Copia de seguridad en este equipo ----
  function usuarioActual() {
    return (
      (typeof obtenerSesionActual === 'function' && obtenerSesionActual()?.usuario) || 'anonimo'
    );
  }
  const claveLocal = (f) => `borradorJornada:${usuarioActual()}:${f}`;
  function guardarLocal(f, campos) {
    try {
      if (!Object.keys(campos).length) localStorage.removeItem(claveLocal(f));
      else localStorage.setItem(claveLocal(f), JSON.stringify({ campos, ts: Date.now() }));
    } catch (_) {
      /* Almacenamiento lleno o bloqueado: el guardado en el servidor sigue funcionando */
    }
  }
  function leerLocal(f) {
    try {
      return JSON.parse(localStorage.getItem(claveLocal(f)));
    } catch (_) {
      return null;
    }
  }
  function valoresSucios() {
    const campos = {};
    sucios.forEach((c) => (campos[c] = LECTORES[c]()));
    return campos;
  }

  // ---- Envío al servidor ----
  // Devuelve { ok, estado }. "urgente" usa keepalive para que el navegador lo
  // complete aunque la pestaña se esté cerrando.
  async function enviar(f, campos, urgente = false) {
    try {
      const respuesta = await fetch(`/api/jornadas/${encodeURIComponent(f)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(campos),
        keepalive: urgente
      });
      if (respuesta.ok) return { ok: true, estado: respuesta.status };
      const datos = await respuesta.json().catch(() => ({}));
      return { ok: false, estado: respuesta.status, mensaje: datos.mensaje };
    } catch (_) {
      return { ok: false, estado: 0 }; // Sin conexión
    }
  }

  async function guardar(urgente = false) {
    if (!listo || cierreDiaGuardado || !sucios.size) return true;
    if (enVuelo) {
      repetir = true;
      return enVuelo;
    }
    const fechaGuardado = fechaEdicion || fecha.value;
    const enviados = valoresSucios();
    mostrar('Guardando…');
    enVuelo = (async () => {
      const r = await enviar(fechaGuardado, enviados, urgente);
      if (r.ok) {
        // Se quitan de "sucios" solo los campos que no cambiaron mientras se guardaba.
        Object.keys(enviados).forEach((c) => {
          if (LECTORES[c]() === enviados[c]) sucios.delete(c);
        });
        guardarLocal(fechaGuardado, valoresSucios());
        clearTimeout(reintento);
        mostrar(sucios.size ? 'Guardando…' : `✓ Borrador guardado ${hora()}`, 'correcto');
        return true;
      }
      if (r.estado === 409) {
        // Alguien cerró el día mientras tanto: se recarga lo que hay en el servidor.
        sucios.clear();
        guardarLocal(fechaGuardado, {});
        mostrar('La jornada ya fue cerrada', 'error');
        if (typeof cargarLecturasInicialesDesdeUltimoCierre === 'function')
          cargarLecturasInicialesDesdeUltimoCierre();
        return false;
      }
      if (r.estado === 401) {
        mostrar(
          'Tu sesión venció: inicia sesión de nuevo. Lo escrito queda en este equipo.',
          'error'
        );
        return false;
      }
      if (r.estado >= 400 && r.estado < 500) {
        mostrar(r.mensaje || 'No se pudo guardar el borrador.', 'error');
        return false; // Error de datos: no se reintenta solo
      }
      // Sin conexión o error del servidor: queda en este equipo y se reintenta.
      mostrar('Sin conexión: guardado en este equipo', 'aviso');
      clearTimeout(reintento);
      reintento = setTimeout(() => guardar(), REINTENTO_MS);
      return false;
    })();
    const resultado = await enVuelo;
    enVuelo = null;
    if (repetir) {
      repetir = false;
      if (sucios.size) guardar();
    }
    return resultado;
  }

  function programarGuardado() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => guardar(), ESPERA_GUARDADO_MS);
  }

  // ---- El usuario tocó un campo ----
  function marcarSucio(campo) {
    if (cierreDiaGuardado) return;
    if (!fechaEdicion) fechaEdicion = fecha.value;
    sucios.add(campo);
    guardarLocal(fechaEdicion, valoresSucios()); // Copia inmediata en este equipo
    if (listo) {
      mostrar('Guardando…');
      programarGuardado();
    } else {
      mostrar('Sin conexión: guardado en este equipo', 'aviso');
    }
  }

  function aplicarValor(campo, valor) {
    if (NOMBRES_CHECKLIST[campo]) {
      const opcion = [
        ...document.querySelectorAll(`input[name="${NOMBRES_CHECKLIST[campo]}"]`)
      ].find((r) => r.value === valor);
      document
        .querySelectorAll(`input[name="${NOMBRES_CHECKLIST[campo]}"]`)
        .forEach((r) => (r.checked = false));
      if (opcion) opcion.checked = true;
    } else {
      LECTORES_INPUT[campo].value = valor;
    }
  }
  const LECTORES_INPUT = { m1Inicial, m1Final, m2Inicial, m2Final };

  // ---- API que usa app.js ----
  window.JornadaBorrador = {
    // Se llama cuando el servidor respondió con el estado de la jornada.
    alRestaurar(jornada) {
      listo = true;
      cargaFallida = false;
      fechaEdicion = fecha.value;
      if (jornada && jornada.estado === 'cerrada') {
        sucios.clear();
        guardarLocal(fecha.value, {});
        mostrar('Jornada cerrada', 'correcto');
        return;
      }
      // Lo que quedó escrito en este equipo sin subir (por falta de señal) se une y se sube.
      const local = leerLocal(fecha.value);
      if (local && local.campos && Object.keys(local.campos).length) {
        Object.entries(local.campos).forEach(([campo, valor]) => {
          if (LECTORES[campo]) {
            aplicarValor(campo, valor);
            sucios.add(campo);
          }
        });
        if (typeof calcularGalones === 'function') calcularGalones();
        mostrar('Se recuperaron lecturas guardadas en este equipo', 'aviso');
        guardar();
        return;
      }
      mostrar(
        jornada ? `✓ Borrador guardado ${hora(jornada.actualizadaEn)}` : '',
        jornada ? 'correcto' : ''
      );
    },
    // La carga inicial falló: se sigue guardando en este equipo hasta tener conexión.
    alFallarLaCarga() {
      cargaFallida = true;
      listo = false;
      mostrar('Sin conexión: lo que escribas se guarda en este equipo', 'aviso');
    },
    // Fuerza el guardado ahora (p. ej. antes de cerrar sesión).
    async guardarYa() {
      clearTimeout(temporizador);
      return guardar();
    },
    hayCambiosSinSubir: () => sucios.size > 0
  };

  // ---- Eventos ----
  Object.keys(LECTORES_INPUT).forEach((campo) =>
    LECTORES_INPUT[campo].addEventListener('input', () => marcarSucio(campo))
  );
  Object.entries(NOMBRES_CHECKLIST).forEach(([campo, nombre]) =>
    document
      .querySelectorAll(`input[name="${nombre}"]`)
      .forEach((r) => r.addEventListener('change', () => marcarSucio(campo)))
  );

  // Cambiar de fecha: lo pendiente de la fecha anterior se envía a SU fecha, sin mezclarse.
  fecha.addEventListener('change', () => {
    if (!sucios.size || !fechaEdicion) {
      fechaEdicion = null;
      listo = false; // app.js vuelve a cargar y llamará alRestaurar
      return;
    }
    const fechaVieja = fechaEdicion;
    const pendientes = valoresSucios();
    sucios.clear();
    fechaEdicion = null;
    listo = false;
    enviar(fechaVieja, pendientes).then((r) => {
      if (!r.ok) guardarLocal(fechaVieja, pendientes); // Se conserva para la próxima vez que abra esa fecha
    });
  });

  // Al ocultar o cerrar la pestaña: último intento con keepalive.
  function alSalir() {
    if (!sucios.size || !listo || cierreDiaGuardado) return;
    clearTimeout(temporizador);
    enviar(fechaEdicion || fecha.value, valoresSucios(), true);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') alSalir();
  });
  window.addEventListener('pagehide', alSalir);

  // Volvió la conexión: se sube lo pendiente (o se recarga el estado si nunca cargó).
  window.addEventListener('online', () => {
    if (cargaFallida && typeof cargarLecturasInicialesDesdeUltimoCierre === 'function')
      cargarLecturasInicialesDesdeUltimoCierre();
    else guardar();
  });
})();
