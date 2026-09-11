// ============================================================================
// mysql-record.repository.js (INFRAESTRUCTURA) — SQL DE LOS REGISTROS
// ----------------------------------------------------------------------------
// Todas las consultas sobre la tabla registros_combustible. Reglas generales:
//   * Ningún listado muestra registros con estado 'ANULADO'.
//   * cierre_dia=1 marca la fila de cierre diario (no es una carga real).
// ============================================================================

const { RecordRepository } = require('../domain/record.repository');

class MySQLRecordRepository extends RecordRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Conexion dedicada para operaciones que deben correr en una sola
  // transaccion (p. ej. crear un registro junto con su alerta).
  getConnection() {
    return this.db.getConnection();
  }

  // Todos los registros vigentes, del más nuevo al más viejo.
  async list() {
    const [filas] = await this.db.query(
      "SELECT * FROM registros_combustible WHERE estado<>'ANULADO' ORDER BY id DESC"
    );
    return filas;
  }

  // Un registro por id (incluye los anulados: se usa para validar y auditar).
  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM registros_combustible WHERE id=?', [id]);
    return filas[0] || null;
  }

  // "connection" es opcional: si se pasa una conexion abierta en transaccion
  // (ver record.service.js), se usa esa; si no, se toma una del pool normal.
  async insert(datos, connection = this.db) {
    const [resultado] = await connection.query(
      `INSERT INTO registros_combustible(fecha,m1_inicial,m1_final,m2_inicial,m2_final,galones_m1,galones_m2,total_galones,fuga_biodiesel,sistema_electrico,parada_emergencia,cierre_dia,operario,cedula,maquina,horometro,cantidad,numero_sai,firma,observaciones) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        // El patrón "|| null" convierte cadenas vacías y ceros en NULL para no
        // guardar basura en columnas numéricas.
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
        datos.cierreDia ? 1 : 0, // MySQL guarda booleanos como 1/0
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

  // Radiografía de los medidores para una fecha: qué hay hoy y cómo cerró ayer.
  // El formulario la usa para precargar las lecturas iniciales y el service
  // para validar que los medidores sean continuos entre días.
  async getDailyMeterState(fecha) {
    const [filasDia] = await this.db.query(
      `SELECT id,fecha,m1_inicial,m1_final,m2_inicial,m2_final,cierre_dia,operario,maquina FROM registros_combustible WHERE fecha=? AND estado<>'ANULADO' ORDER BY id DESC`,
      [fecha]
    );
    // DATE_SUB(...,INTERVAL 1 DAY) = el día anterior a la fecha consultada.
    const [filasDiaAnterior] = await this.db.query(
      `SELECT id,fecha,m1_final,m2_final,cierre_dia FROM registros_combustible WHERE fecha=DATE_SUB(?,INTERVAL 1 DAY) AND estado<>'ANULADO' ORDER BY id DESC`,
      [fecha]
    );
    const cierreActual = filasDia.find((fila) => Number(fila.cierre_dia) === 1) || null;
    const cierreAnterior = filasDiaAnterior.find((fila) => Number(fila.cierre_dia) === 1) || null;
    return {
      fecha,
      hayRegistrosDia: filasDia.length > 0, // ¿Hubo movimiento hoy?
      hayCierreDia: Boolean(cierreActual), // ¿El día ya está cerrado?
      cierreActual, // La fila del cierre de hoy, si existe
      fechaAnterior: filasDiaAnterior[0]?.fecha || null,
      hayRegistrosDiaAnterior: filasDiaAnterior.length > 0,
      hayCierreDiaAnterior: Boolean(cierreAnterior),
      m1Anterior: cierreAnterior?.m1_final ?? null, // Lectura con la que debe abrir hoy M1
      m2Anterior: cierreAnterior?.m2_final ?? null // Lectura con la que debe abrir hoy M2
    };
  }

  // ¿Esta fecha ya tiene cierre de día? (evita cierres duplicados)
  async findDailyClosing(fecha) {
    const [filas] = await this.db.query(
      "SELECT id FROM registros_combustible WHERE fecha=? AND cierre_dia=1 AND estado<>'ANULADO' LIMIT 1",
      [fecha || null]
    );
    return filas[0] || null;
  }

  // Actualiza un cierre existente. COALESCE(?,columna) significa: "si el valor
  // nuevo viene vacío, deja el que ya estaba" — así una edición parcial no
  // borra datos previos.
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
        // El checklist solo se escribe si aún no lo llenó otro registro del día.
        requiereChecklist ? datos.fugaBiodiesel || null : null,
        requiereChecklist ? datos.sistemaElectrico || null : null,
        requiereChecklist ? datos.paradaEmergencia || null : null,
        id
      ]
    );
  }

  // ¿Ya se diligenció el checklist de inspección en esta fecha?
  // idExcluido permite ignorar el propio registro que se está editando.
  async hasChecklist(fecha, idExcluido = null) {
    const condiciones = [
      'fecha=?',
      "estado<>'ANULADO'",
      // Basta con que UNO de los tres campos del checklist tenga valor.
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

  // Estadísticas de consumo por máquina en un rango de fechas.
  // El LEFT JOIN con tractores trae la capacidad y descripción de cada equipo.
  // Alimenta los gráficos y tablas analíticas de la pantalla de reportes.
  async machineConsumptionStats(inicio, fin) {
    const [filas] = await this.db.query(
      `SELECT r.maquina,COUNT(*) AS registros,COALESCE(SUM(r.cantidad),0) AS total_galones,COALESCE(AVG(r.cantidad),0) AS promedio_galones,COALESCE(MAX(r.cantidad),0) AS maximo_galones,COALESCE(t.capacidad_galones,0) AS capacidad_galones,t.descripcion AS descripcion FROM registros_combustible r LEFT JOIN tractores t ON UPPER(t.maquina)=UPPER(r.maquina) WHERE r.cierre_dia=0 AND r.estado<>'ANULADO' AND r.fecha BETWEEN ? AND ? AND r.cantidad IS NOT NULL AND r.cantidad>0 GROUP BY r.maquina,t.capacidad_galones,t.descripcion ORDER BY total_galones DESC`,
      [inicio, fin]
    );
    // MySQL devuelve los DECIMAL como texto: se convierten a número para el frontend.
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

  // Promedio histórico de galones de una máquina y cuántas cargas lo sustentan.
  // Es la base de la alerta por "consumo sobre el promedio" (ver record.service.js).
  // idExcluido evita que el registro recién insertado se promedie consigo mismo.
  async averageQuantityByMachine(maquina, idExcluido = null) {
    const condiciones = [
      'cierre_dia=0', // Los cierres de día no son cargas
      "estado<>'ANULADO'",
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

  // Último horómetro válido de una máquina. El REGEXP descarta los horómetros
  // escritos con texto y el REPLACE acepta tanto coma como punto decimal.
  async latestHourmeter(maquina) {
    const [filas] = await this.db.query(
      `SELECT MAX(CAST(REPLACE(horometro,',','.') AS DECIMAL(12,2))) AS ultimo_horometro FROM registros_combustible WHERE maquina=? AND estado<>'ANULADO' AND horometro REGEXP '^[0-9]+([,.][0-9]+)?$'`,
      [maquina || '']
    );
    return Number(filas[0].ultimo_horometro) || 0;
  }

  // Consulta por rango de fechas con búsqueda opcional por máquina u operario.
  // Es lo que alimenta la pantalla de Tablas y la generación de reportes.
  async findByDateRange(inicio, fin, busqueda = '') {
    const condiciones = ['fecha BETWEEN ? AND ?', "estado<>'ANULADO'"];
    const valores = [inicio, fin];
    if (busqueda) {
      condiciones.push('(maquina LIKE ? OR operario LIKE ?)');
      valores.push(`%${busqueda}%`, `%${busqueda}%`); // % = comodín de LIKE
    }
    const [filas] = await this.db.query(
      `SELECT * FROM registros_combustible WHERE ${condiciones.join(' AND ')} ORDER BY fecha ASC,id ASC`,
      valores
    );
    return filas;
  }

  // Edición parcial de un registro.
  // LISTA BLANCA DE CAMPOS EDITABLES: solo estos siete se pueden modificar.
  // Las lecturas de medidores y la firma NO son editables a propósito.
  // Si necesitas permitir editar otro campo, agrégalo a columnasPermitidas.
  async update(id, cambios) {
    const columnasPermitidas = {
      operario: 'operario', // nombre en el frontend -> columna en MySQL
      cedula: 'cedula',
      maquina: 'maquina',
      horometro: 'horometro',
      cantidad: 'cantidad',
      numeroSai: 'numero_sai',
      observaciones: 'observaciones'
    };
    // Se descarta cualquier campo que no esté en la lista blanca.
    const entradas = Object.entries(cambios).filter(([campo]) => columnasPermitidas[campo]);
    if (!entradas.length) return false; // Nada válido que actualizar
    await this.db.query(
      // El SET se arma dinámicamente, pero solo con nombres de columna de la
      // lista blanca; los valores siempre van como parámetros "?".
      `UPDATE registros_combustible SET ${entradas.map(([campo]) => `${columnasPermitidas[campo]}=?`).join(',')} WHERE id=?`,
      [
        ...entradas.map(([campo, valor]) =>
          // Estos tres campos se guardan siempre en mayúsculas.
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

  // Anula el registro en vez de borrarlo fisicamente: conserva el dato
  // historico y deja quien/cuando/por que se anulo.
  async remove(id, motivo, usuario) {
    const [resultado] = await this.db.query(
      "UPDATE registros_combustible SET estado='ANULADO',motivo_anulacion=?,usuario_anulacion=?,fecha_anulacion=NOW() WHERE id=? AND estado<>'ANULADO'",
      [motivo || null, usuario || null, id]
    );
    return resultado.affectedRows > 0;
  }

  // Totales por año y mes, usados para crear/actualizar los reportes mensuales.
  // El CASE WHEN gigante sirve para EXCLUIR las filas de cierre de día del
  // conteo: se detectan por cierre_dia=1 o, en registros antiguos donde esa
  // columna no existía, porque tienen las cuatro lecturas y no tienen operario
  // ni máquina (misma lógica que record.mapper.js).
  async summarizeByMonth() {
    const [filas] = await this.db.query(
      `SELECT YEAR(fecha) AS anio,MONTH(fecha) AS mes,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN 0 ELSE 1 END),0) AS totalRegistros,COALESCE(SUM(CASE WHEN(cierre_dia=1 OR(cierre_dia=0 AND m1_inicial IS NOT NULL AND m1_final IS NOT NULL AND m2_inicial IS NOT NULL AND m2_final IS NOT NULL AND(operario IS NULL OR TRIM(operario)='') AND(maquina IS NULL OR TRIM(maquina)=''))) THEN COALESCE(total_galones,0) ELSE 0 END),0) AS totalGalones FROM registros_combustible WHERE fecha IS NOT NULL AND estado<>'ANULADO' GROUP BY YEAR(fecha),MONTH(fecha)`
    );
    return filas;
  }
}

module.exports = { MySQLRecordRepository };
