const { RecordRepository } = require('../domain/record.repository');

class MySQLRecordRepository extends RecordRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  async list() {
    const [filas] = await this.db.query('SELECT * FROM registros_combustible ORDER BY id DESC');
    return filas;
  }

  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM registros_combustible WHERE id=?', [id]);
    return filas[0] || null;
  }

  async insert(datos) {
    const [resultado] = await this.db.query(
      `INSERT INTO registros_combustible(fecha,m1_inicial,m1_final,m2_inicial,m2_final,galones_m1,galones_m2,total_galones,fuga_biodiesel,sistema_electrico,parada_emergencia,cierre_dia,operario,cedula,maquina,horometro,cantidad,numero_sai,firma,observaciones) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        datos.fecha || null,
        datos.m1Inicial || null,
        datos.m1Final || null,
        datos.m2Inicial || null,
        datos.m2Final || null,
        datos.galonesM1 || null,
        datos.galonesM2 || null,
        datos.totalGalones || null,
        datos.fugaBiodiesel || null,
        datos.sistemaElectrico || null,
        datos.paradaEmergencia || null,
        datos.cierreDia ? 1 : 0,
        datos.operario || null,
        datos.cedula || null,
        datos.maquina || null,
        datos.horometro || null,
        datos.cantidad || null,
        datos.numeroSai || null,
        datos.firma || null,
        datos.observaciones || null
      ]
    );
    return resultado.insertId;
  }

  async getDailyMeterState(fecha) {
    const [filasDia] = await this.db.query(
      `SELECT id,fecha,m1_inicial,m1_final,m2_inicial,m2_final,cierre_dia,operario,maquina FROM registros_combustible WHERE fecha=? ORDER BY id DESC`,
      [fecha]
    );
    const [filasDiaAnterior] = await this.db.query(
      `SELECT id,fecha,m1_final,m2_final,cierre_dia FROM registros_combustible WHERE fecha=DATE_SUB(?,INTERVAL 1 DAY) ORDER BY id DESC`,
      [fecha]
    );
    const cierreActual = filasDia.find((fila) => Number(fila.cierre_dia) === 1) || null;
    const cierreAnterior = filasDiaAnterior.find((fila) => Number(fila.cierre_dia) === 1) || null;
    return {
      fecha,
      hayRegistrosDia: filasDia.length > 0,
      hayCierreDia: Boolean(cierreActual),
      cierreActual,
      fechaAnterior: filasDiaAnterior[0]?.fecha || null,
      hayRegistrosDiaAnterior: filasDiaAnterior.length > 0,
      hayCierreDiaAnterior: Boolean(cierreAnterior),
      m1Anterior: cierreAnterior?.m1_final ?? null,
      m2Anterior: cierreAnterior?.m2_final ?? null
    };
  }

  async findDailyClosing(fecha) {
    const [filas] = await this.db.query(
      'SELECT id FROM registros_combustible WHERE fecha=? AND cierre_dia=1 LIMIT 1',
      [fecha || null]
    );
    return filas[0] || null;
  }

  async updateDailyClosing(id, datos, requiereChecklist) {
    await this.db.query(
      `UPDATE registros_combustible SET m1_inicial=COALESCE(?,m1_inicial),m1_final=COALESCE(?,m1_final),m2_inicial=COALESCE(?,m2_inicial),m2_final=COALESCE(?,m2_final),galones_m1=COALESCE(?,galones_m1),galones_m2=COALESCE(?,galones_m2),total_galones=COALESCE(?,total_galones),fuga_biodiesel=COALESCE(?,fuga_biodiesel),sistema_electrico=COALESCE(?,sistema_electrico),parada_emergencia=COALESCE(?,parada_emergencia) WHERE id=?`,
      [
        datos.m1Inicial || null,
        datos.m1Final || null,
        datos.m2Inicial || null,
        datos.m2Final || null,
        datos.galonesM1 || null,
        datos.galonesM2 || null,
        datos.totalGalones || null,
        requiereChecklist ? datos.fugaBiodiesel || null : null,
        requiereChecklist ? datos.sistemaElectrico || null : null,
        requiereChecklist ? datos.paradaEmergencia || null : null,
        id
      ]
    );
  }

  async hasChecklist(fecha, idExcluido = null) {
    const condiciones = [
      'fecha=?',
      '(fuga_biodiesel IS NOT NULL OR sistema_electrico IS NOT NULL OR parada_emergencia IS NOT NULL)'
    ];
    const valores = [fecha || null];
    if (idExcluido) {
      condiciones.push('id<>?');
      valores.push(idExcluido);
    }
    const [filas] = await this.db.query(
      `SELECT id FROM registros_combustible WHERE ${condiciones.join(' AND ')} LIMIT 1`,
      valores
    );
    return filas.length > 0;
  }

  async machineConsumptionStats(inicio, fin) {
    const [filas] = await this.db.query(
      `SELECT r.maquina,COUNT(*) AS registros,COALESCE(SUM(r.cantidad),0) AS total_galones,COALESCE(AVG(r.cantidad),0) AS promedio_galones,COALESCE(MAX(r.cantidad),0) AS maximo_galones,COALESCE(t.capacidad_galones,0) AS capacidad_galones,t.descripcion AS descripcion FROM registros_combustible r LEFT JOIN tractores t ON UPPER(t.maquina)=UPPER(r.maquina) WHERE r.cierre_dia=0 AND r.fecha BETWEEN ? AND ? AND r.cantidad IS NOT NULL AND r.cantidad>0 GROUP BY r.maquina,t.capacidad_galones,t.descripcion ORDER BY total_galones DESC`,
      [inicio, fin]
    );
    return filas.map((fila) => ({
      ...fila,
      registros: Number(fila.registros),
      totalGalones: Number(fila.total_galones),
      promedioGalones: Number(fila.promedio_galones),
      maximoGalones: Number(fila.maximo_galones),
      capacidadGalones: Number(fila.capacidad_galones),
      descripcion: fila.descripcion || null
    }));
  }

  async averageQuantityByMachine(maquina, idExcluido = null) {
    const condiciones = [
      'cierre_dia=0',
      'cantidad IS NOT NULL',
      'cantidad>0',
      'UPPER(maquina)=UPPER(?)'
    ];
    const valores = [maquina || ''];
    if (idExcluido) {
      condiciones.push('id<>?');
      valores.push(idExcluido);
    }
    const [filas] = await this.db.query(
      `SELECT COUNT(*) AS muestras,COALESCE(AVG(cantidad),0) AS promedio FROM registros_combustible WHERE ${condiciones.join(' AND ')}`,
      valores
    );
    return { muestras: Number(filas[0]?.muestras || 0), promedio: Number(filas[0]?.promedio || 0) };
  }

  async latestHourmeter(maquina) {
    const [filas] = await this.db.query(
      `SELECT MAX(CAST(REPLACE(horometro,',','.') AS DECIMAL(12,2))) AS ultimo_horometro FROM registros_combustible WHERE maquina=? AND horometro REGEXP '^[0-9]+([,.][0-9]+)?$'`,
      [maquina || '']
    );
    return Number(filas[0].ultimo_horometro) || 0;
  }

  async findByDateRange(inicio, fin, busqueda = '') {
    const condiciones = ['fecha BETWEEN ? AND ?'];
    const valores = [inicio, fin];
    if (busqueda) {
      condiciones.push('(maquina LIKE ? OR operario LIKE ?)');
      valores.push(`%${busqueda}%`, `%${busqueda}%`);
    }
    const [filas] = await this.db.query(
      `SELECT * FROM registros_combustible WHERE ${condiciones.join(' AND ')} ORDER BY fecha ASC,id ASC`,
      valores
    );
    return filas;
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
    await this.db.query(
      `UPDATE registros_combustible SET ${entradas.map(([campo]) => `${columnasPermitidas[campo]}=?`).join(',')} WHERE id=?`,
      [
        ...entradas.map(([campo, valor]) =>
          ['operario', 'maquina', 'numeroSai'].includes(campo)
            ? String(valor || '')
                .trim()
                .toUpperCase()
            : valor
        ),
        id
      ]
    );
    return true;
  }

  async remove(id) {
    await this.db.query('DELETE FROM registros_combustible WHERE id=?', [id]);
  }

  async summarizeByMonth() {
    const [filas] = await this.db.query(
      `SELECT YEAR(fecha) AS anio,MONTH(fecha) AS mes,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN 0 ELSE 1 END),0) AS totalRegistros,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN COALESCE(total_galones,0) ELSE 0 END),0) AS totalGalones FROM registros_combustible WHERE fecha IS NOT NULL GROUP BY YEAR(fecha),MONTH(fecha)`
    );
    return filas;
  }
}

module.exports = { MySQLRecordRepository };
