// ============================================================================
// jornada.service.js (APLICACIÓN) — REGLAS DE LA JORNADA DIARIA
// ----------------------------------------------------------------------------
// La jornada es el día de trabajo del surtidor: lecturas M1/M2 + checklist.
//   * guardarBorrador(): autoguardado. El operario puede salir de la app y
//     volver a cualquier hora del día: lo que escribió sigue en la jornada.
//   * cerrar(): el cierre definitivo. Solo hay UN cierre por día.
//   * pendientes()/ejecutarRecordatorios(): jornadas que nadie ha cerrado.
// PARA CAMBIAR LA HORA A PARTIR DE LA CUAL SE AVISA -> HORA_LIMITE_CIERRE (.env).
// ============================================================================

const {
  hoyLocal,
  minutosLocales,
  sumarDias,
  esFechaValida,
  horaLimiteCierreMinutos
} = require('../../shared/application/fechas');
const { convertirJornadaParaFrontend } = require('../domain/jornada.mapper');

const bad = (mensaje, status = 400) => Object.assign(new Error(mensaje), { status });
const CAMPOS_LECTURA = ['m1Inicial', 'm1Final', 'm2Inicial', 'm2Final'];
const CAMPOS_CHECKLIST = ['fugaBiodiesel', 'sistemaElectrico', 'paradaEmergencia'];
const redondear = (n) => Math.round(n * 100) / 100;

class JornadaService {
  constructor(repository, alertService, notificador) {
    this.repository = repository;
    this.alertService = alertService;
    this.notificador = notificador; // Envía notificaciones push (puede ser null)
  }

  // Valida y limpia los campos que llegan del frontend.
  //   soloNoVacios=true  -> un campo vacío se IGNORA (no borra lo ya guardado).
  //   soloNoVacios=false -> un campo vacío BORRA el valor (borrador editable).
  normalizarCampos(datos = {}, soloNoVacios = false) {
    const campos = {};
    for (const campo of CAMPOS_LECTURA) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      if (crudo === null || String(crudo).trim() === '') {
        if (!soloNoVacios) campos[campo] = null;
        continue;
      }
      const numero = Number(String(crudo).replace(',', '.'));
      if (!Number.isFinite(numero) || numero < 0)
        throw bad(`La lectura ${campo.slice(0, 2).toUpperCase()} no es un número válido.`);
      campos[campo] = numero;
    }
    for (const campo of CAMPOS_CHECKLIST) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      const texto = String(crudo ?? '').trim();
      if (!texto) {
        if (!soloNoVacios) campos[campo] = null;
        continue;
      }
      if (texto.length > 30) throw bad('El valor del checklist es demasiado largo.');
      campos[campo] = texto;
    }
    return campos;
  }

  // Si el día anterior tiene cierre, las lecturas iniciales de hoy SON sus finales
  // (los medidores son continuos). Se fuerzan aquí para que nadie las altere.
  async aplicarInicialesDelCierreAnterior(fecha, campos, tx) {
    const anterior = await this.repository.findByFecha(sumarDias(fecha, -1), tx);
    if (anterior?.estado !== 'cerrada') return { campos, anterior: null };
    const ajustados = { ...campos };
    if (anterior.m1_final !== null && anterior.m1_final !== undefined)
      ajustados.m1Inicial = Number(anterior.m1_final);
    if (anterior.m2_final !== null && anterior.m2_final !== undefined)
      ajustados.m2Inicial = Number(anterior.m2_final);
    return { campos: ajustados, anterior };
  }

  validarFecha(fecha) {
    if (!esFechaValida(fecha)) throw bad('La fecha no es válida.');
    if (fecha > hoyLocal()) throw bad('La fecha no puede ser posterior a hoy.');
  }

  // Guarda lo que el operario lleva escrito (autoguardado). Crea la jornada del
  // día la primera vez. No exige que esté completa: es un borrador.
  //   soloNoVacios=true lo usa el registro de suministros, que reenvía los mismos
  //   campos y no debe borrar nada.
  async guardarBorrador(fecha, datos, usuario, { soloNoVacios = false } = {}, tx) {
    this.validarFecha(fecha);
    const normalizados = this.normalizarCampos(datos, soloNoVacios);
    const { campos } = await this.aplicarInicialesDelCierreAnterior(fecha, normalizados, tx);
    // Los galones solo se calculan al cerrar; un borrador no los guarda.
    const existente = await this.repository.findByFecha(fecha, tx);
    if (existente?.estado === 'cerrada') {
      if (soloNoVacios) return existente; // Un suministro tardío no reabre ni modifica el cierre
      throw bad('La jornada de esta fecha ya fue cerrada.', 409);
    }
    return this.repository.guardar(fecha, campos, usuario, {}, tx);
  }

  // Estado de la jornada para pintar el formulario: lo guardado (borrador o
  // cierre) y con qué lecturas debe empezar el día.
  async getDailyMeterState(fecha) {
    if (!esFechaValida(fecha)) throw bad('La fecha no es válida.');
    const anteriorFecha = sumarDias(fecha, -1);
    const actual = await this.repository.findByFecha(fecha);
    const anterior = await this.repository.findByFecha(anteriorFecha);
    const suministrosDia = await this.repository.countSuministros(fecha);
    const suministrosAnterior = await this.repository.countSuministros(anteriorFecha);
    const cierreActual = actual?.estado === 'cerrada' ? actual : null;
    const cierreAnterior = anterior?.estado === 'cerrada' ? anterior : null;
    return {
      fecha,
      hayRegistrosDia: suministrosDia > 0 || Boolean(actual),
      hayCierreDia: Boolean(cierreActual),
      cierreActual, // Fila del cierre (solo si el día ya está cerrado)
      jornada: convertirJornadaParaFrontend(actual), // Borrador o cierre, en camelCase
      fechaAnterior: anterior || suministrosAnterior > 0 ? anteriorFecha : null,
      hayRegistrosDiaAnterior: Boolean(anterior) || suministrosAnterior > 0,
      hayCierreDiaAnterior: Boolean(cierreAnterior),
      // Si ayer se quedó sin cerrar, el frontend lo avisa y permite cerrarlo.
      anteriorAbierta:
        anterior?.estado === 'abierta' ? convertirJornadaParaFrontend(anterior) : null,
      m1Anterior: cierreAnterior?.m1_final ?? null, // Lectura con la que debe abrir hoy M1
      m2Anterior: cierreAnterior?.m2_final ?? null // Lectura con la que debe abrir hoy M2
    };
  }

  // Cierre definitivo de la jornada. Solo UN cierre por día; el super
  // administrador es el único que puede corregir un cierre ya hecho.
  async cerrar(datos, usuario, rol) {
    const fecha = String(datos.fecha || '').slice(0, 10);
    this.validarFecha(fecha);

    return this.repository.transaction(async (tx) => {
      const existente = await this.repository.findByFecha(fecha, tx);
      if (existente?.estado === 'cerrada' && rol !== 'super_administrador')
        throw bad('La jornada de esta fecha ya fue cerrada. Solo hay un cierre por día.', 409);

      // Lo que llega ahora se suma a lo ya guardado como borrador.
      const enviados = this.normalizarCampos(datos, true);
      const { campos: conIniciales, anterior } = await this.aplicarInicialesDelCierreAnterior(
        fecha,
        enviados,
        tx
      );
      // Si se intentó poner una inicial distinta a la del cierre anterior, se avisa.
      if (anterior) {
        for (const [campo, columna] of [
          ['m1Inicial', 'm1_final'],
          ['m2Inicial', 'm2_final']
        ]) {
          if (
            enviados[campo] !== undefined &&
            anterior[columna] !== null &&
            Number(enviados[campo]) !== Number(anterior[columna])
          )
            throw bad(
              `La lectura inicial de ${campo.slice(0, 2).toUpperCase()} debe coincidir con el cierre anterior: ${anterior[columna]}.`
            );
        }
      }

      const previo = existente || {};
      const lectura = (campo, columna) =>
        conIniciales[campo] !== undefined
          ? conIniciales[campo]
          : previo[columna] === null || previo[columna] === undefined
            ? null
            : Number(previo[columna]);
      const m1Inicial = lectura('m1Inicial', 'm1_inicial');
      const m1Final = lectura('m1Final', 'm1_final');
      const m2Inicial = lectura('m2Inicial', 'm2_inicial');
      const m2Final = lectura('m2Final', 'm2_final');

      if (m1Final === null && m2Final === null)
        throw bad('Debes ingresar al menos una lectura final: M1, M2 o ambas.');
      if (m1Final !== null && (m1Inicial === null || m1Final < m1Inicial))
        throw bad('La lectura final de M1 no puede ser menor que su inicial.');
      if (m2Final !== null && (m2Inicial === null || m2Final < m2Inicial))
        throw bad('La lectura final de M2 no puede ser menor que su inicial.');

      // Los galones los calcula el servidor (no se confía en el navegador).
      const galonesM1 = m1Final !== null ? redondear(m1Final - m1Inicial) : null;
      const galonesM2 = m2Final !== null ? redondear(m2Final - m2Inicial) : null;
      const totalGalones =
        galonesM1 === null && galonesM2 === null
          ? null
          : redondear((galonesM1 || 0) + (galonesM2 || 0));

      const jornada = await this.repository.guardar(
        fecha,
        {
          ...conIniciales,
          m1Inicial,
          m1Final,
          m2Inicial,
          m2Final,
          galonesM1,
          galonesM2,
          totalGalones
        },
        usuario,
        { cerrar: true, permitirCerrada: rol === 'super_administrador' },
        tx
      );
      if (!jornada) throw bad('La jornada de esta fecha ya fue cerrada.', 409);

      // Ya no está pendiente: se resuelve el aviso de "cierre pendiente" si lo hubo.
      if (this.alertService?.resolverPorJornada)
        await this.alertService.resolverPorJornada(jornada.id, 'cierre_pendiente', usuario, tx);

      // Alerta: se cerró el día sin diligenciar el checklist de inspección.
      const hayChecklist = CAMPOS_CHECKLIST.some((c) => {
        const columna = {
          fugaBiodiesel: 'fuga_biodiesel',
          sistemaElectrico: 'sistema_electrico',
          paradaEmergencia: 'parada_emergencia'
        }[c];
        return String(jornada[columna] || '').trim() !== '';
      });
      if (this.alertService && !hayChecklist) {
        await this.alertService.create(
          {
            jornadaId: jornada.id,
            fecha,
            maquina: 'Cierre de día',
            operario: null,
            cantidad: 0,
            capacidadGalones: 0,
            excesoGalones: 0,
            observaciones: 'Checklist diario sin diligenciar.',
            tipoAlerta: 'inspeccion_pendiente'
          },
          tx
        );
      }
      return convertirJornadaParaFrontend(jornada);
    });
  }

  // Jornadas que siguen abiertas y ya deberían estar cerradas:
  //   * de días anteriores (vencidas), o
  //   * de hoy, pasada la hora límite (HORA_LIMITE_CIERRE).
  // Tambien devuelve la jornada de hoy si está abierta (para el indicador de borrador).
  async pendientes(ahora = new Date()) {
    const hoy = hoyLocal(ahora);
    const abiertas = await this.repository.listAbiertasHasta(hoy);
    const tarde = minutosLocales(ahora) >= horaLimiteCierreMinutos();
    const pendientes = abiertas
      .filter((j) => j.fecha < hoy || tarde)
      .map((j) => ({
        ...convertirJornadaParaFrontend(j),
        motivo: j.fecha < hoy ? 'vencida' : 'hoy_tarde'
      }));
    return { hoy, pendientes };
  }

  // Tarea programada (cron): crea la alerta "cierre pendiente" para supervisores
  // (una sola vez por jornada) y manda una notificación push a quienes deben cerrar.
  async ejecutarRecordatorios(ahora = new Date()) {
    const { pendientes } = await this.pendientes(ahora);
    let alertasNuevas = 0;
    for (const j of pendientes) {
      const alerta = await this.alertService.create({
        jornadaId: Number(j.id),
        fecha: j.fecha,
        maquina: 'Cierre de día',
        operario: j.abiertaPor || null,
        cantidad: 0,
        capacidadGalones: 0,
        excesoGalones: 0,
        observaciones: `La jornada del ${j.fecha} sigue abierta.`,
        tipoAlerta: 'cierre_pendiente'
      });
      if (alerta?.nueva) alertasNuevas += 1;
    }
    let push = { enviados: 0, omitido: true };
    if (pendientes.length && this.notificador) {
      const masAntigua = pendientes[0].fecha;
      push = await this.notificador.notificar(
        { vista: 'registro', roles: ['supervisor', 'administrador', 'super_administrador'] },
        {
          titulo: 'Falta cerrar la jornada',
          cuerpo:
            pendientes.length === 1
              ? `La jornada del ${masAntigua} sigue abierta. Ingresa las lecturas finales de M1 y M2 y guarda el cierre.`
              : `Hay ${pendientes.length} jornadas sin cerrar (desde el ${masAntigua}).`,
          url: '/index',
          etiqueta: 'cierre-pendiente'
        }
      );
    }
    return { pendientes: pendientes.length, alertasNuevas, push };
  }

  listByDateRange(inicio, fin) {
    return this.repository.listByDateRange(inicio, fin);
  }
}

module.exports = { JornadaService };
