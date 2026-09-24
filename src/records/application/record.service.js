// ============================================================================
// record.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE LOS SUMINISTROS
// ----------------------------------------------------------------------------
// Un "registro" es UN suministro de combustible a UNA máquina.
// Las lecturas de los medidores M1/M2 y el checklist son de la JORNADA del día
// (ver src/jornadas/): aquí solo se aseguran de estar guardadas como borrador
// al registrar un suministro.
// Al crear un suministro se validan los datos y se generan las alertas:
//   1. sobrecapacidad  (más galones de los que cabe en el tanque)
//   2. promedio        (25 % por encima de su promedio histórico)
//   3. horometro_irregular (horómetro con texto en vez de número)
// PARA CAMBIAR UMBRALES -> MIN_MUESTRAS_PROMEDIO y FACTOR_ALERTA_PROMEDIO en .env.
// ============================================================================

const { convertirRegistroParaFrontend } = require('../domain/record.mapper');
const { hoyLocal, esFechaValida } = require('../../shared/application/fechas');

const bad = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const noExiste = () => Object.assign(new Error('El registro no existe.'), { status: 404 });
const HOROMETRO_NUMERICO = /^[0-9]+([.,][0-9]+)?$/; // Solo dígitos con coma o punto decimal

class RecordService {
  // jornadaService guarda el borrador de la jornada del día junto con el suministro.
  constructor(repository, tractorRepository, alertService, jornadaService) {
    this.repository = repository;
    this.tractorRepository = tractorRepository;
    this.alertService = alertService;
    this.jornadaService = jornadaService;
  }

  // Todos los suministros vigentes, ya en el formato que espera el frontend.
  async list() {
    return (await this.repository.list()).map(convertirRegistroParaFrontend);
  }

  // GUARDAR un suministro. "usuario" es quien lo registra (queda en el historial).
  async create(datos, usuario) {
    // Se normaliza el texto para que "juan" y "JUAN" sean el mismo operario.
    datos = {
      ...datos,
      operario: String(datos.operario || '')
        .trim()
        .toUpperCase(),
      maquina: String(datos.maquina || '')
        .trim()
        .toUpperCase(),
      cedula: String(datos.cedula || '').trim(),
      numeroSai: String(datos.numeroSai || '')
        .trim()
        .toUpperCase()
    };

    if (!datos.firma) throw bad('La firma del operario es obligatoria.');

    const fecha = String(datos.fecha || '').slice(0, 10);
    if (!esFechaValida(fecha)) throw bad('La fecha del registro no es válida.');
    if (fecha > hoyLocal()) throw bad('La fecha del registro no puede ser posterior a hoy.');

    // El horómetro (horas de la máquina) solo puede avanzar, nunca retroceder.
    const horometroNumero = Number(String(datos.horometro || '').replace(',', '.'));
    if (Number.isFinite(horometroNumero)) {
      const ultimo = await this.repository.latestHourmeter(datos.maquina);
      if (ultimo && horometroNumero < ultimo)
        throw bad(
          `El horometro no puede ser menor al ultimo registrado para ${datos.maquina}: ${ultimo}.`
        );
    }

    // La capacidad del tanque se consulta ANTES de abrir la transacción (así la
    // transacción dura lo mínimo).
    const tractor = datos.maquina
      ? await this.tractorRepository.findByMachine(datos.maquina)
      : null;
    const capacidad = Number(tractor?.capacidad_galones || 0); // 0 = sin capacidad definida

    // Todo en una transacción: o se guarda el suministro con su jornada y
    // alertas, o no se guarda nada.
    const alertasNuevas = []; // Alertas creadas por este registro (para avisar por push al terminar)
    const resultado = await this.repository.transaction(async (tx) => {
      // Crea una alerta dentro de la transacción y la anota si es nueva.
      const crearAlerta = async (datosAlerta) => {
        const alerta = await this.alertService.create(datosAlerta, tx);
        if (alerta?.nueva) alertasNuevas.push(alerta);
        return alerta;
      };
      // La jornada del día guarda las lecturas iniciales y el checklist que trae
      // el formulario (sin borrar nada de lo ya guardado).
      const jornada = await this.jornadaService.guardarBorrador(
        fecha,
        datos,
        usuario,
        { soloNoVacios: true },
        tx
      );
      const hayInicial =
        (jornada?.m1_inicial !== null && jornada?.m1_inicial !== undefined) ||
        (jornada?.m2_inicial !== null && jornada?.m2_inicial !== undefined);
      if (!hayInicial)
        throw bad('Debes tener al menos una lectura inicial disponible para iniciar el registro.');

      const id = await this.repository.insert({ ...datos, fecha, registradoPor: usuario }, tx);

      const cantidad = Number(datos.cantidad || 0); // Galones cargados

      // El tanque móvil es un depósito que se rellena: no genera alertas de
      // ningún tipo (ni sobrecapacidad, ni promedio, ni horómetro).
      const esTanqueMovil =
        Number(tractor?.item) === 73 ||
        /^TANQUE M[OÓ][VB]IL/.test(datos.maquina) ||
        /^TANQUE M[OÓ][VB]IL/.test(String(tractor?.descripcion || '').trim().toUpperCase());

      if (this.alertService && !esTanqueMovil) {
        // ALERTA 1 (sobrecapacidad): se cargó más de lo que cabe en el tanque.
        // Si ya excede la capacidad, no se evalúa el promedio (sería redundante).
        if (capacidad > 0 && cantidad > capacidad) {
          await crearAlerta({
            registroId: id,
            fecha,
            maquina: datos.maquina,
            operario: datos.operario,
            cantidad,
            capacidadGalones: capacidad,
            excesoGalones: cantidad - capacidad, // Cuánto se pasó
            observaciones: datos.observaciones,
            tipoAlerta: 'sobrecapacidad'
          });
        } else {
          // ALERTA 2 (promedio): consumo muy por encima de lo habitual de esa máquina.
          const estadistica = await this.repository.averageQuantityByMachine(datos.maquina, id, tx);
          const minimoMuestras = Number(process.env.MIN_MUESTRAS_PROMEDIO || 5); // Mínimo de cargas previas
          const factor = Number(process.env.FACTOR_ALERTA_PROMEDIO || 1.25); // 1.25 = 25 % por encima
          if (
            estadistica.muestras >= minimoMuestras && // Con pocos datos el promedio no es confiable
            estadistica.promedio > 0 &&
            cantidad > estadistica.promedio * factor
          ) {
            const porcentaje = (cantidad / estadistica.promedio - 1) * 100; // % de exceso
            await crearAlerta({
              registroId: id,
              fecha,
              maquina: datos.maquina,
              operario: datos.operario,
              cantidad,
              capacidadGalones: 0,
              excesoGalones: cantidad - estadistica.promedio,
              observaciones: datos.observaciones,
              tipoAlerta: 'promedio',
              promedioGalones: estadistica.promedio,
              porcentajeSobrePromedio: porcentaje
            });
          }
        }

        // ALERTA 3 (horómetro irregular): se escribió texto en vez de un número.
        const horometroTexto = String(datos.horometro || '').trim();
        if (horometroTexto && !HOROMETRO_NUMERICO.test(horometroTexto)) {
          const anterior = await this.repository.latestHourmeter(datos.maquina, tx);
          await crearAlerta({
            registroId: id,
            fecha,
            maquina: datos.maquina,
            operario: datos.operario,
            cantidad,
            capacidadGalones: 0,
            excesoGalones: 0,
            observaciones: datos.observaciones,
            tipoAlerta: 'horometro_irregular',
            detalle: horometroTexto, // Lo que escribió el usuario
            valorReferencia: anterior || null // Último valor válido conocido
          });
        }
      }

      return {
        ...datos,
        id: String(id),
        capacidadGalones: capacidad,
        alertaSobrecapacidad: capacidad > 0 && cantidad > capacidad
      };
    });

    // El registro ya está guardado: se avisa por push a administradores y supervisores.
    // (Va DESPUÉS de la transacción para no avisar de algo que se pudiera deshacer.)
    if (this.alertService?.notificarPush) await this.alertService.notificarPush(alertasNuevas);
    return resultado;
  }

  // Galones por máquina en un rango de fechas (gráficas de análisis).
  machineConsumptionStats(inicio, fin) {
    return this.repository.machineConsumptionStats(inicio, fin);
  }

  // Consulta filtrada por fechas y texto libre (pantalla de Tablas y reportes).
  listByDateRange(inicio, fin, busqueda) {
    return this.repository
      .findByDateRange(inicio, fin, busqueda)
      .then((filas) => filas.map(convertirRegistroParaFrontend));
  }

  // Registro crudo por id (sin traducir), para validaciones y auditoría.
  // El id es un número en Postgres y un texto "recXXXXXXXXXXXXXX" en Airtable:
  // si no tiene ninguna de las dos formas, no puede existir y se corta aquí
  // (si no, Postgres respondería con un error de tipo de dato en vez de "no existe").
  async findById(id) {
    const texto = String(id ?? '').trim();
    if (!/^\d+$/.test(texto) && !/^rec[A-Za-z0-9]{10,}$/.test(texto)) return null;
    return this.repository.findById(texto);
  }

  // Edición: prohibida sobre registros anulados.
  async update(id, cambios) {
    const actual = await this.findById(id);
    if (!actual) throw noExiste();
    if (actual.estado === 'ANULADO') throw bad('No se puede editar un registro anulado.');
    return this.repository.update(id, cambios);
  }

  // ANULAR un registro: motivo obligatorio, debe existir y no estar ya anulado.
  // Nunca se borra la fila.
  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio) throw bad('El motivo de anulación es obligatorio.');
    const actual = await this.findById(id);
    if (!actual) throw noExiste();
    if (actual.estado === 'ANULADO') throw bad('Este registro ya está anulado.');
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual;
  }
}

module.exports = { RecordService };
