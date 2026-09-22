// ============================================================================
// airtable-record.repository.js (INFRAESTRUCTURA) — SUMINISTROS EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-record.repository.js. Las agregaciones que en Postgres
// hace SQL (SUM/AVG/MAX/GROUP BY) aquí se calculan en JavaScript después de
// traer las filas, porque Airtable no las tiene.
// ============================================================================

const { RecordRepository } = require('../domain/record.repository');
const { textoFormula, combinarFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'registros_combustible';
const TABLA_TRACTORES = 'tractores';
const fechaFormula = (valor) => `DATETIME_FORMAT({fecha},'YYYY-MM-DD')=${textoFormula(valor)}`;
const HOROMETRO_NUMERICO = /^[0-9]+([.,][0-9]+)?$/;

class AirtableRecordRepository extends RecordRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  transaction(funcion) {
    return this.cliente.transaction(funcion);
  }

  async list() {
    return this.cliente.listar(TABLA, {
      formula: `{estado}!='ANULADO'`,
      orden: [{ campo: 'registrado_en', direccion: 'desc' }]
    });
  }

  async findById(id) {
    return this.cliente.obtener(TABLA, id);
  }

  async insert(datos, tx = this.cliente) {
    const [fila] = await tx.crear(TABLA, [
      {
        fecha: datos.fecha,
        operario: datos.operario || null,
        cedula: datos.cedula || null,
        maquina: datos.maquina || null,
        horometro: datos.horometro || null,
        cantidad: datos.cantidad || null,
        numero_sai: datos.numeroSai || null,
        firma: datos.firma || null,
        observaciones: datos.observaciones || null,
        registrado_por: datos.registradoPor || null,
        registrado_en: new Date().toISOString(),
        estado: 'ACTIVO'
      }
    ]);
    return fila.id;
  }

  // Galones por máquina en un rango de fechas. Se trae también el catálogo de
  // tractores (suele ser pequeño) para cruzar capacidad/descripción en memoria,
  // en lugar del LEFT JOIN que hace Postgres.
  async machineConsumptionStats(inicio, fin) {
    const [registros, tractores] = await Promise.all([
      this.cliente.listar(TABLA, {
        formula: combinarFormula('AND', [
          `{estado}!='ANULADO'`,
          `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>=${textoFormula(inicio)}`,
          `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fin)}`,
          `{cantidad}>0`
        ])
      }),
      this.cliente.listar(TABLA_TRACTORES)
    ]);
    const tractorPorMaquina = new Map(
      tractores.map((t) => [String(t.maquina || '').toUpperCase(), t])
    );

    const grupos = new Map(); // MAQUINA -> { maquina, total_galones, registros, maximo_galones }
    for (const r of registros) {
      const clave = String(r.maquina || '').toUpperCase();
      const nodo = grupos.get(clave) || {
        maquina: r.maquina,
        total_galones: 0,
        registros: 0,
        maximo_galones: 0
      };
      const cantidad = Number(r.cantidad) || 0;
      nodo.total_galones += cantidad;
      nodo.registros += 1;
      nodo.maximo_galones = Math.max(nodo.maximo_galones, cantidad);
      grupos.set(clave, nodo);
    }

    return [...grupos.entries()]
      .map(([clave, nodo]) => {
        const tractor = tractorPorMaquina.get(clave);
        const fila = {
          maquina: nodo.maquina,
          registros: nodo.registros,
          total_galones: nodo.total_galones,
          promedio_galones: nodo.total_galones / nodo.registros,
          maximo_galones: nodo.maximo_galones,
          capacidad_galones: Number(tractor?.capacidad_galones || 0),
          descripcion: tractor?.descripcion || null
        };
        // Mismo formato dual (snake_case + camelCase) que devuelve la versión de Postgres.
        return {
          ...fila,
          totalGalones: fila.total_galones,
          promedioGalones: fila.promedio_galones,
          maximoGalones: fila.maximo_galones,
          capacidadGalones: fila.capacidad_galones
        };
      })
      .sort((a, b) => b.total_galones - a.total_galones);
  }

  async averageQuantityByMachine(maquina, idExcluido = null, tx = this.cliente) {
    const filas = await tx.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{estado}!='ANULADO'`,
        `{cantidad}>0`,
        `UPPER({maquina})=UPPER(${textoFormula(maquina || '')})`,
        idExcluido ? `RECORD_ID()!=${textoFormula(idExcluido)}` : ''
      ])
    });
    const muestras = filas.length;
    const promedio = muestras
      ? filas.reduce((t, f) => t + (Number(f.cantidad) || 0), 0) / muestras
      : 0;
    return { muestras, promedio };
  }

  async latestHourmeter(maquina, tx = this.cliente) {
    const filas = await tx.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{maquina}=${textoFormula(maquina || '')}`,
        `{estado}!='ANULADO'`
      ])
    });
    let ultimo = 0;
    for (const f of filas) {
      const texto = String(f.horometro || '').trim();
      if (!HOROMETRO_NUMERICO.test(texto)) continue;
      const valor = Number(texto.replace(',', '.'));
      if (valor > ultimo) ultimo = valor;
    }
    return ultimo;
  }

  async findByDateRange(inicio, fin, busqueda = '') {
    const condiciones = [
      `{estado}!='ANULADO'`,
      `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>=${textoFormula(inicio)}`,
      `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fin)}`
    ];
    if (busqueda) {
      const valor = textoFormula(busqueda);
      condiciones.push(
        combinarFormula('OR', [
          `FIND(LOWER(${valor}),LOWER({maquina}))>0`,
          `FIND(LOWER(${valor}),LOWER({operario}))>0`
        ])
      );
    }
    return this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', condiciones),
      orden: [
        { campo: 'fecha', direccion: 'asc' },
        { campo: 'registrado_en', direccion: 'asc' }
      ]
    });
  }

  async update(id, cambios) {
    const columnasPermitidas = {
      operario: 'operario',
      cedula: 'cedula',
      maquina: 'maquina',
      horometro: 'horometro',
      cantidad: 'cantidad',
      numeroSai: 'numero_sai',
      observaciones: 'observaciones'
    };
    const entradas = Object.entries(cambios).filter(([campo]) => columnasPermitidas[campo]);
    if (!entradas.length) return false;
    const campos = {};
    for (const [campo, valor] of entradas) {
      const normalizado = ['operario', 'maquina', 'numeroSai'].includes(campo)
        ? String(valor || '')
            .trim()
            .toUpperCase()
        : valor === ''
          ? null
          : valor;
      campos[columnasPermitidas[campo]] = normalizado;
    }
    await this.cliente.actualizar(TABLA, [{ id, campos }]);
    return true;
  }

  async remove(id, motivo, usuario) {
    const existente = await this.cliente.obtener(TABLA, id);
    if (!existente || existente.estado === 'ANULADO') return false;
    await this.cliente.actualizar(TABLA, [
      {
        id,
        campos: {
          estado: 'ANULADO',
          motivo_anulacion: motivo || null,
          usuario_anulacion: usuario || null,
          fecha_anulacion: new Date().toISOString()
        }
      }
    ]);
    return true;
  }

  async summarizeByMonth() {
    const filas = await this.cliente.listar(TABLA, { formula: `{estado}!='ANULADO'` });
    const grupos = new Map();
    for (const f of filas) {
      const clave = String(f.fecha || '').slice(0, 7);
      if (!clave) continue;
      const nodo = grupos.get(clave) || {
        anio: Number(clave.slice(0, 4)),
        mes: Number(clave.slice(5, 7)),
        total_registros: 0,
        total_suministrado: 0
      };
      nodo.total_registros += 1;
      nodo.total_suministrado += Number(f.cantidad) || 0;
      grupos.set(clave, nodo);
    }
    return [...grupos.values()];
  }
}

module.exports = { AirtableRecordRepository };
