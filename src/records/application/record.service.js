// ============================================================================
// record.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE LOS REGISTROS
// ----------------------------------------------------------------------------
// Es el archivo con más lógica del backend. Aquí se decide:
//   * Qué validaciones debe pasar una carga de combustible antes de guardarse.
//   * CUÁNDO SE GENERA UNA ALERTA (sobrecapacidad, consumo sobre el promedio,
//     horómetro irregular, checklist sin diligenciar).
//   * Cómo se guarda y valida el cierre del día.
// SI QUIERES AJUSTAR LA SENSIBILIDAD DE LAS ALERTAS DE PROMEDIO, no toques el
// código: usa las variables de entorno MIN_MUESTRAS_PROMEDIO y
// FACTOR_ALERTA_PROMEDIO en el archivo .env.
// ============================================================================

const { convertirRegistroParaFrontend } = require('../domain/record.mapper');
// Atajo para lanzar errores de validación con código HTTP 400 (petición inválida).
const bad = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
// Un horómetro "normal" es solo números con decimales opcionales (1234 o 1234,5).
// Si no cumple este patrón se considera irregular y se genera una alerta.
const HOROMETRO_NUMERICO = /^[0-9]+([.,][0-9]+)?$/;

class RecordService {
  // Necesita tres colaboradores: sus propios datos, el catálogo de máquinas
  // (para conocer la capacidad del tanque) y el servicio de alertas.
  constructor(repository, tractorRepository, alertService) {
    this.repository = repository;
    this.tractorRepository = tractorRepository;
    this.alertService = alertService;
  }

  // Lista todos los registros ya traducidos al formato del frontend.
  async list() {
    return (await this.repository.list()).map(convertirRegistroParaFrontend);
  }

  // ---------------------------------------------------------------------------
  // CREAR UN REGISTRO DE CARGA DE COMBUSTIBLE
  // ---------------------------------------------------------------------------
  async create(datos) {
    // 1) Normalización: mayúsculas y sin espacios sobrantes, para que los datos
    //    coincidan con los catálogos de máquinas y operarios.
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

    // 2) Validaciones básicas obligatorias.
    if (!datos.m1Inicial && !datos.m2Inicial)
      throw bad('Debes tener al menos una lectura inicial disponible para iniciar el registro.');
    if (!datos.firma) throw bad('La firma del operario es obligatoria.');

    // 3) No se aceptan registros con fecha futura.
    const fecha = String(datos.fecha || '').slice(0, 10);
    if (fecha && fecha > new Date().toISOString().slice(0, 10))
      throw bad('La fecha del registro no puede ser posterior a hoy.');

    // 4) ¿Este registro es el cierre del día? Se acepta booleano, número o texto
    //    porque el dato puede venir de distintos formularios.
    const cierre =
      datos.cierreDia === true ||
      datos.cierreDia === 1 ||
      datos.cierreDia === '1' ||
      datos.cierreDia === 'true';
    // Solo puede haber un cierre por fecha.
    if (cierre && (await this.repository.findDailyClosing(datos.fecha)))
      throw bad('Ya existe un cierre del dia para esta fecha.');

    // 5) El horómetro de una máquina nunca puede retroceder (las horas solo suman).
    const horometroNumero = Number(String(datos.horometro || '').replace(',', '.'));
    if (Number.isFinite(horometroNumero)) {
      const ultimo = await this.repository.latestHourmeter(datos.maquina);
      if (ultimo && horometroNumero < ultimo)
        throw bad(
          `El horometro no puede ser menor al ultimo registrado para ${datos.maquina}: ${ultimo}.`
        );
    }

    // 6) El checklist (fuga, sistema eléctrico, parada de emergencia) se llena
    //    una sola vez al día: si ya hay uno, este registro no lo repite.
    const requiereChecklist = !(await this.repository.hasChecklist(datos.fecha));

    // El registro y las alertas que dispara van en una sola transaccion: si
    // algo falla a mitad de camino, no debe quedar un registro sin su alerta.
    const usaTransaccion = typeof this.repository.getConnection === 'function';
    const connection = usaTransaccion ? await this.repository.getConnection() : null;
    let id;
    let cantidad;
    let capacidad;

    try {
      if (connection) await connection.beginTransaction();

      // --- Inserción del registro ---
      id = await this.repository.insert(
        {
          ...datos,
          cierreDia: cierre,
          // Los campos del checklist solo se guardan si toca diligenciarlo.
          fugaBiodiesel: requiereChecklist ? datos.fugaBiodiesel : null,
          sistemaElectrico: requiereChecklist ? datos.sistemaElectrico : null,
          paradaEmergencia: requiereChecklist ? datos.paradaEmergencia : null
        },
        connection || undefined
      );

      cantidad = Number(datos.cantidad || 0); // Galones cargados
      // Se busca la máquina para conocer la capacidad de su tanque.
      const tractor =
        !cierre && datos.maquina && this.tractorRepository
          ? await this.tractorRepository.findByMachine(datos.maquina)
          : null;
      capacidad = Number(tractor?.capacidad_galones || 0);

      // --- GENERACIÓN AUTOMÁTICA DE ALERTAS (solo en cargas, no en cierres) ---
      if (this.alertService && !cierre) {
        // ALERTA 1: se cargaron más galones de los que cabe en el tanque.
        if (capacidad > 0 && cantidad > capacidad) {
          await this.alertService.create(
            {
              registroId: id,
              fecha: datos.fecha,
              maquina: datos.maquina,
              operario: datos.operario,
              cantidad,
              capacidadGalones: capacidad,
              excesoGalones: cantidad - capacidad, // Cuánto se pasó
              observaciones: datos.observaciones,
              tipoAlerta: 'sobrecapacidad'
            },
            connection
          );
        } else if (this.repository.averageQuantityByMachine) {
          // ALERTA 2: el consumo se sale del promedio histórico de la máquina.
          const estadistica = await this.repository.averageQuantityByMachine(datos.maquina, id);
          const minimoMuestras = Number(process.env.MIN_MUESTRAS_PROMEDIO || 5); // Mínimo de cargas previas
          const factor = Number(process.env.FACTOR_ALERTA_PROMEDIO || 1.25); // 1.25 = 25% por encima
          if (
            estadistica.muestras >= minimoMuestras && // Con pocos datos el promedio no es confiable
            estadistica.promedio > 0 &&
            cantidad > estadistica.promedio * factor
          ) {
            const porcentaje = (cantidad / estadistica.promedio - 1) * 100; // % de exceso
            await this.alertService.create(
              {
                registroId: id,
                fecha: datos.fecha,
                maquina: datos.maquina,
                operario: datos.operario,
                cantidad,
                capacidadGalones: 0,
                excesoGalones: cantidad - estadistica.promedio,
                observaciones: datos.observaciones,
                tipoAlerta: 'promedio',
                promedioGalones: estadistica.promedio,
                porcentajeSobrePromedio: porcentaje
              },
              connection
            );
          }
        }

        // ALERTA 3: el horómetro trae texto raro en vez de un número.
        const horometroTexto = String(datos.horometro || '').trim();
        if (horometroTexto && !HOROMETRO_NUMERICO.test(horometroTexto)) {
          const anterior = this.repository.latestHourmeter
            ? await this.repository.latestHourmeter(datos.maquina)
            : 0;
          await this.alertService.create(
            {
              registroId: id,
              fecha: datos.fecha,
              maquina: datos.maquina,
              operario: datos.operario,
              cantidad,
              capacidadGalones: 0,
              excesoGalones: 0,
              observaciones: datos.observaciones,
              tipoAlerta: 'horometro_irregular',
              detalle: horometroTexto, // Lo que escribió el usuario
              valorReferencia: anterior || null // Último valor válido conocido
            },
            connection
          );
        }
      }

      if (connection) await connection.commit(); // Todo salió bien: se confirma
    } catch (error) {
      if (connection) await connection.rollback(); // Algo falló: se deshace todo
      throw error;
    } finally {
      if (connection) connection.release(); // La conexión vuelve al pool siempre
    }

    // Respuesta al frontend, incluyendo si hubo alerta de sobrecapacidad para
    // poder mostrar el aviso en pantalla.
    return {
      ...datos,
      id: String(id),
      capacidadGalones: capacidad,
      alertaSobrecapacidad: capacidad > 0 && cantidad > capacidad
    };
  }

  // Estado de los medidores de una fecha (lecturas iniciales/finales y si el
  // día anterior quedó cerrado). Lo usa el formulario para precargar valores.
  async getDailyMeterState(fecha) {
    return this.repository.getDailyMeterState(fecha);
  }

  // Estadísticas de consumo por máquina en un rango (para reportes y gráficos).
  machineConsumptionStats(inicio, fin) {
    return this.repository.machineConsumptionStats(inicio, fin);
  }

  // ---------------------------------------------------------------------------
  // GUARDAR EL CIERRE DEL DÍA (lecturas finales de los medidores)
  // ---------------------------------------------------------------------------
  async saveDailyClosing(datos) {
    if (!datos.m1Final && !datos.m2Final)
      throw bad('Debes ingresar al menos una lectura final: M1, M2 o ambas.');
    const fechaCierre = String(datos.fecha || '').slice(0, 10);
    if (fechaCierre && fechaCierre > new Date().toISOString().slice(0, 10))
      throw bad('La fecha del cierre no puede ser posterior a hoy.');

    // CONTINUIDAD DE LOS MEDIDORES: la lectura inicial de hoy debe ser
    // exactamente la final de ayer; si no coincide, se rechaza el cierre.
    const estado = await this.repository.getDailyMeterState(datos.fecha);
    if (estado.hayCierreDiaAnterior) {
      if (
        estado.m1Anterior !== null &&
        String(datos.m1Inicial || '') !== '' &&
        Number(datos.m1Inicial) !== Number(estado.m1Anterior)
      )
        throw bad(
          `La lectura inicial de M1 debe coincidir con el cierre anterior: ${estado.m1Anterior}.`
        );
      if (
        estado.m2Anterior !== null &&
        String(datos.m2Inicial || '') !== '' &&
        Number(datos.m2Inicial) !== Number(estado.m2Anterior)
      )
        throw bad(
          `La lectura inicial de M2 debe coincidir con el cierre anterior: ${estado.m2Anterior}.`
        );
      // Se fuerzan las iniciales del cierre anterior para evitar desfases.
      datos.m1Inicial = estado.m1Anterior ?? datos.m1Inicial;
      datos.m2Inicial = estado.m2Anterior ?? datos.m2Inicial;
    }

    // Un medidor no puede marcar menos al final del día que al inicio.
    if (datos.m1Final && (!datos.m1Inicial || Number(datos.m1Final) < Number(datos.m1Inicial)))
      throw bad('La lectura final de M1 no puede ser menor que su inicial.');
    if (datos.m2Final && (!datos.m2Inicial || Number(datos.m2Final) < Number(datos.m2Inicial)))
      throw bad('La lectura final de M2 no puede ser menor que su inicial.');

    // Si el día ya tenía cierre se actualiza; si no, se crea uno nuevo.
    const cierre = await this.repository.findDailyClosing(datos.fecha);
    let id;
    if (cierre) {
      const requiereChecklist = !(await this.repository.hasChecklist(datos.fecha, cierre.id));
      await this.repository.updateDailyClosing(cierre.id, datos, requiereChecklist);
      id = cierre.id;
    } else {
      const requiereChecklist = !(await this.repository.hasChecklist(datos.fecha));
      // El cierre es un registro "vacío" de operario/máquina: solo medidores.
      id = await this.repository.insert({
        ...datos,
        cierreDia: true,
        operario: null,
        cedula: null,
        maquina: null,
        horometro: null,
        cantidad: null,
        numeroSai: null,
        firma: null,
        observaciones: null,
        fugaBiodiesel: requiereChecklist ? datos.fugaBiodiesel : null,
        sistemaElectrico: requiereChecklist ? datos.sistemaElectrico : null,
        paradaEmergencia: requiereChecklist ? datos.paradaEmergencia : null
      });
    }

    // ALERTA 4: se cerró el día sin haber diligenciado el checklist de inspección.
    if (this.alertService && !(await this.repository.hasChecklist(datos.fecha))) {
      await this.alertService.create({
        registroId: id,
        fecha: datos.fecha,
        maquina: 'Cierre de día',
        operario: null,
        cantidad: 0,
        capacidadGalones: 0,
        excesoGalones: 0,
        observaciones: 'Checklist diario sin diligenciar.',
        tipoAlerta: 'inspeccion_pendiente'
      });
    }

    return convertirRegistroParaFrontend(await this.repository.findById(id));
  }

  // Consulta filtrada por fechas y texto libre (pantalla de Tablas).
  listByDateRange(inicio, fin, busqueda) {
    return this.repository
      .findByDateRange(inicio, fin, busqueda)
      .then((filas) => filas.map(convertirRegistroParaFrontend));
  }

  // Registro crudo por id (sin traducir), para validaciones internas.
  async findById(id) {
    return this.repository.findById(id);
  }

  // Edición: prohibida sobre registros anulados.
  async update(id, cambios) {
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El registro no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO') throw bad('No se puede editar un registro anulado.');
    return this.repository.update(id, cambios);
  }

  // ANULAR un registro: mismo patrón que máquinas y operarios (motivo obligatorio,
  // debe existir y no estar ya anulado). Nunca se borra la fila.
  async remove(id, motivo, usuario) {
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio) throw bad('El motivo de anulación es obligatorio.');
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El registro no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO') throw bad('Este registro ya está anulado.');
    await this.repository.remove(id, motivoLimpio, usuario);
    return actual;
  }
}

module.exports = { RecordService };
