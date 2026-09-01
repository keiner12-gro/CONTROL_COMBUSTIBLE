const { convertirRegistroParaFrontend } = require('../domain/record.mapper');
const bad = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const HOROMETRO_NUMERICO = /^[0-9]+([.,][0-9]+)?$/;

class RecordService {
  constructor(repository, tractorRepository, alertService) {
    this.repository = repository;
    this.tractorRepository = tractorRepository;
    this.alertService = alertService;
  }

  async list() {
    return (await this.repository.list()).map(convertirRegistroParaFrontend);
  }

  async create(datos) {
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
    if (!datos.m1Inicial && !datos.m2Inicial)
      throw bad('Debes tener al menos una lectura inicial disponible para iniciar el registro.');
    if (!datos.firma) throw bad('La firma del operario es obligatoria.');

    const fecha = String(datos.fecha || '').slice(0, 10);
    if (fecha && fecha > new Date().toISOString().slice(0, 10))
      throw bad('La fecha del registro no puede ser posterior a hoy.');

    const cierre =
      datos.cierreDia === true ||
      datos.cierreDia === 1 ||
      datos.cierreDia === '1' ||
      datos.cierreDia === 'true';
    if (cierre && (await this.repository.findDailyClosing(datos.fecha)))
      throw bad('Ya existe un cierre del dia para esta fecha.');

    const horometroNumero = Number(String(datos.horometro || '').replace(',', '.'));
    if (Number.isFinite(horometroNumero)) {
      const ultimo = await this.repository.latestHourmeter(datos.maquina);
      if (ultimo && horometroNumero < ultimo)
        throw bad(
          `El horometro no puede ser menor al ultimo registrado para ${datos.maquina}: ${ultimo}.`
        );
    }

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

      id = await this.repository.insert(
        {
          ...datos,
          cierreDia: cierre,
          fugaBiodiesel: requiereChecklist ? datos.fugaBiodiesel : null,
          sistemaElectrico: requiereChecklist ? datos.sistemaElectrico : null,
          paradaEmergencia: requiereChecklist ? datos.paradaEmergencia : null
        },
        connection || undefined
      );

      cantidad = Number(datos.cantidad || 0);
      const tractor =
        !cierre && datos.maquina && this.tractorRepository
          ? await this.tractorRepository.findByMachine(datos.maquina)
          : null;
      capacidad = Number(tractor?.capacidad_galones || 0);

      if (this.alertService && !cierre) {
        if (capacidad > 0 && cantidad > capacidad) {
          await this.alertService.create(
            {
              registroId: id,
              fecha: datos.fecha,
              maquina: datos.maquina,
              operario: datos.operario,
              cantidad,
              capacidadGalones: capacidad,
              excesoGalones: cantidad - capacidad,
              observaciones: datos.observaciones,
              tipoAlerta: 'sobrecapacidad'
            },
            connection
          );
        } else if (this.repository.averageQuantityByMachine) {
          const estadistica = await this.repository.averageQuantityByMachine(datos.maquina, id);
          const minimoMuestras = Number(process.env.MIN_MUESTRAS_PROMEDIO || 5);
          const factor = Number(process.env.FACTOR_ALERTA_PROMEDIO || 1.25);
          if (
            estadistica.muestras >= minimoMuestras &&
            estadistica.promedio > 0 &&
            cantidad > estadistica.promedio * factor
          ) {
            const porcentaje = (cantidad / estadistica.promedio - 1) * 100;
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
              detalle: horometroTexto,
              valorReferencia: anterior || null
            },
            connection
          );
        }
      }

      if (connection) await connection.commit();
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }

    return {
      ...datos,
      id: String(id),
      capacidadGalones: capacidad,
      alertaSobrecapacidad: capacidad > 0 && cantidad > capacidad
    };
  }

  async getDailyMeterState(fecha) {
    return this.repository.getDailyMeterState(fecha);
  }

  machineConsumptionStats(inicio, fin) {
    return this.repository.machineConsumptionStats(inicio, fin);
  }

  async saveDailyClosing(datos) {
    if (!datos.m1Final && !datos.m2Final)
      throw bad('Debes ingresar al menos una lectura final: M1, M2 o ambas.');
    const fechaCierre = String(datos.fecha || '').slice(0, 10);
    if (fechaCierre && fechaCierre > new Date().toISOString().slice(0, 10))
      throw bad('La fecha del cierre no puede ser posterior a hoy.');

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
      datos.m1Inicial = estado.m1Anterior ?? datos.m1Inicial;
      datos.m2Inicial = estado.m2Anterior ?? datos.m2Inicial;
    }

    if (datos.m1Final && (!datos.m1Inicial || Number(datos.m1Final) < Number(datos.m1Inicial)))
      throw bad('La lectura final de M1 no puede ser menor que su inicial.');
    if (datos.m2Final && (!datos.m2Inicial || Number(datos.m2Final) < Number(datos.m2Inicial)))
      throw bad('La lectura final de M2 no puede ser menor que su inicial.');

    const cierre = await this.repository.findDailyClosing(datos.fecha);
    let id;
    if (cierre) {
      const requiereChecklist = !(await this.repository.hasChecklist(datos.fecha, cierre.id));
      await this.repository.updateDailyClosing(cierre.id, datos, requiereChecklist);
      id = cierre.id;
    } else {
      const requiereChecklist = !(await this.repository.hasChecklist(datos.fecha));
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

  listByDateRange(inicio, fin, busqueda) {
    return this.repository
      .findByDateRange(inicio, fin, busqueda)
      .then((filas) => filas.map(convertirRegistroParaFrontend));
  }

  async findById(id) {
    return this.repository.findById(id);
  }

  async update(id, cambios) {
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El registro no existe.'), { status: 404 });
    if (actual.estado === 'ANULADO') throw bad('No se puede editar un registro anulado.');
    return this.repository.update(id, cambios);
  }

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
