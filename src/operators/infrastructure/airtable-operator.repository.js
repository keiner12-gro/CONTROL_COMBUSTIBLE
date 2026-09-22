// ============================================================================
// airtable-operator.repository.js (INFRAESTRUCTURA) — OPERARIOS EN AIRTABLE
// ----------------------------------------------------------------------------
// Mismo contrato que pg-operator.repository.js (OperatorRepository).
// ============================================================================

const { OperatorRepository } = require('../domain/operator.repository');

const TABLA = 'operarios';

class AirtableOperatorRepository extends OperatorRepository {
  constructor(cliente) {
    super();
    this.cliente = cliente;
  }

  async list() {
    const filas = await this.cliente.listar(TABLA, {
      formula: `{estado}!='ANULADO'`,
      orden: [{ campo: 'nombre', direccion: 'asc' }]
    });
    return filas.map(({ id, nombre, cedula }) => ({ id, nombre, cedula }));
  }

  async findById(id) {
    return this.cliente.obtener(TABLA, id);
  }

  async create(datos) {
    const nombre = String(datos.nombre || '')
      .trim()
      .toUpperCase();
    const cedula = String(datos.cedula || '').trim();
    const [fila] = await this.cliente.crear(TABLA, [
      { nombre, cedula, estado: 'ACTIVO', creado_en: new Date().toISOString() }
    ]);
    return { id: fila.id, nombre, cedula };
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
}

module.exports = { AirtableOperatorRepository };
