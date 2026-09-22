// ============================================================================
// airtable-tractor.repository.js (INFRAESTRUCTURA) — MAQUINARIA EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-tractor.repository.js (TractorRepository).
// ============================================================================

const { TractorRepository } = require('../domain/tractor.repository');
const { textoFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'tractores';
const soloColumnas = ({ id, item, maquina, descripcion, centro_costo, capacidad_galones }) => ({
  id,
  item,
  maquina,
  descripcion,
  centro_costo,
  capacidad_galones
});

class AirtableTractorRepository extends TractorRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  async list() {
    const filas = await this.cliente.listar(TABLA, {
      formula: `{estado}!='ANULADO'`,
      orden: [
        { campo: 'item', direccion: 'asc' },
        { campo: 'maquina', direccion: 'asc' }
      ]
    });
    return filas.map(soloColumnas);
  }

  async findById(id) {
    return this.cliente.obtener(TABLA, id);
  }

  async findByMachine(maquina) {
    const filas = await this.cliente.listar(TABLA, {
      formula: `UPPER({maquina})=UPPER(${textoFormula(maquina || '')})`,
      maxFilas: 1
    });
    return filas[0] ? soloColumnas(filas[0]) : null;
  }

  async create(datos) {
    // El número de "item" se calcula como el máximo actual + 1 (incluidas las anuladas,
    // igual que en Postgres, para no reutilizar un número ya usado).
    const todas = await this.cliente.listar(TABLA);
    const item = todas.reduce((max, t) => Math.max(max, Number(t.item) || 0), 0) + 1;
    const maquina = String(datos.maquina || '')
      .trim()
      .toUpperCase();
    const descripcion = String(datos.descripcion || '')
      .trim()
      .toUpperCase();
    const centro_costo = String(datos.centro_costo || '')
      .trim()
      .toUpperCase();
    const capacidad_galones = Number(datos.capacidad_galones || 0);
    const [fila] = await this.cliente.crear(TABLA, [
      { item, maquina, descripcion, centro_costo, capacidad_galones, estado: 'ACTIVO' }
    ]);
    return { id: fila.id, item, maquina, descripcion, centro_costo, capacidad_galones };
  }

  async update(id, datos) {
    const existente = await this.cliente.obtener(TABLA, id);
    if (!existente) return null;
    const maquina = String(datos.maquina || '')
      .trim()
      .toUpperCase();
    const descripcion = String(datos.descripcion || '')
      .trim()
      .toUpperCase();
    const centro_costo = String(datos.centro_costo || '')
      .trim()
      .toUpperCase();
    const capacidad_galones = Number(datos.capacidad_galones || 0);
    await this.cliente.actualizar(TABLA, [
      { id, campos: { maquina, descripcion, centro_costo, capacidad_galones } }
    ]);
    return { id, item: existente.item, maquina, descripcion, centro_costo, capacidad_galones };
  }

  async remove(id, motivo, usuario) {
    const existente = await this.cliente.obtener(TABLA, id);
    if (!existente || existente.estado === 'ANULADO') return false; // Ya no existe o ya estaba anulada
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
}

module.exports = { AirtableTractorRepository };
