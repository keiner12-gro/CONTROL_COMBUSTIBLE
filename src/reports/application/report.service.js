// ============================================================================
// report.service.js (APLICACIÓN) — REPORTES MENSUALES Y GENERALES
// ----------------------------------------------------------------------------
// Ya NO existe una tabla de reportes: todo se calcula al momento a partir de
// dos fuentes INDEPENDIENTES:
//   * jornadas   -> lo que salió del surtidor por día (medidores M1 + M2)
//   * registros  -> lo que se suministró a cada máquina
// La CONCILIACIÓN es la diferencia entre ambos totales: combustible que salió
// del surtidor y no quedó asignado a ninguna máquina (o al revés).
// PARA CAMBIAR LA HORA EN QUE SE CONSIDERA CERRADO EL MES -> HORA_CIERRE_MES.
// ============================================================================

const { convertirRegistroParaFrontend } = require('../../records/domain/record.mapper');
const { convertirJornadaParaFrontend } = require('../../jornadas/domain/jornada.mapper');
const { hoyLocal, minutosLocales } = require('../../shared/application/fechas');

const HORA_CIERRE_MES = 17; // El mes se considera cerrado a las 5:00 p. m. del último día
const redondear = (n) => Math.round(Number(n || 0) * 100) / 100;
const dos = (n) => String(n).padStart(2, '0');

// Primer y último día de un mes: { inicio: '2026-09-01', fin: '2026-09-30' }.
function rangoDelMes(anio, mes) {
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate(); // Día 0 del mes siguiente
  return { inicio: `${anio}-${dos(mes)}-01`, fin: `${anio}-${dos(mes)}-${dos(ultimoDia)}` };
}

class ReportService {
  constructor(recordRepository, jornadaRepository) {
    this.records = recordRepository;
    this.jornadas = jornadaRepository;
  }

  // Un resumen por mes con actividad (y siempre el mes en curso), del más reciente al más antiguo.
  async list() {
    const suministros = await this.records.summarizeByMonth();
    const surtidor = await this.jornadas.summarizeByMonth();

    const meses = new Map(); // "2026-09" -> resumen
    const nodo = (anio, mes) => {
      const clave = `${anio}-${dos(mes)}`;
      if (!meses.has(clave))
        meses.set(clave, { anio, mes, totalRegistros: 0, totalSuministrado: 0, totalGalones: 0 });
      return meses.get(clave);
    };
    for (const fila of suministros) {
      const n = nodo(Number(fila.anio), Number(fila.mes));
      n.totalRegistros = Number(fila.total_registros);
      n.totalSuministrado = Number(fila.total_suministrado);
    }
    for (const fila of surtidor)
      nodo(Number(fila.anio), Number(fila.mes)).totalGalones = Number(fila.total_surtidor);

    const hoy = hoyLocal(); // El mes actual siempre aparece, aunque no tenga datos
    nodo(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)));

    return [...meses.values()]
      .sort((a, b) => b.anio - a.anio || b.mes - a.mes)
      .map((m) => {
        const { inicio, fin } = rangoDelMes(m.anio, m.mes);
        const cerrado = hoy > fin || (hoy === fin && minutosLocales() >= HORA_CIERRE_MES * 60);
        return {
          id: m.anio * 100 + m.mes,
          anio: m.anio,
          mes: m.mes,
          fechaInicio: inicio,
          fechaFin: fin,
          fechaCierre: `${fin} ${dos(HORA_CIERRE_MES)}:00:00`,
          estado: cerrado ? 'cerrado' : 'abierto',
          totalRegistros: m.totalRegistros, // Cantidad de suministros
          totalGalones: redondear(m.totalGalones), // Galones del surtidor (M1+M2)
          totalSuministrado: redondear(m.totalSuministrado), // Galones entregados a máquinas
          diferencia: redondear(m.totalGalones - m.totalSuministrado) // Conciliación
        };
      });
  }

  // Datos de un rango de fechas, con las dos fuentes por separado.
  async detalle(inicio, fin, busqueda = '') {
    const suministros = await this.records.findByDateRange(inicio, fin, busqueda);
    const jornadas = await this.jornadas.listByDateRange(inicio, fin);
    const totalSuministrado = suministros.reduce((t, r) => t + Number(r.cantidad || 0), 0);
    const totalSurtidor = jornadas.reduce((t, j) => t + Number(j.total_galones || 0), 0);
    return {
      suministros: suministros.map(convertirRegistroParaFrontend),
      jornadas: jornadas.map(convertirJornadaParaFrontend),
      conciliacion: {
        totalSurtidor: redondear(totalSurtidor),
        totalSuministrado: redondear(totalSuministrado),
        diferencia: redondear(totalSurtidor - totalSuministrado)
      }
    };
  }

  detalleMensual(anio, mes, busqueda = '') {
    const { inicio, fin } = rangoDelMes(anio, mes);
    return this.detalle(inicio, fin, busqueda);
  }
}

module.exports = { ReportService, rangoDelMes };
