// ============================================================================
// migrar-datos.js — PASA LOS DATOS DE LA BASE ANTIGUA (MySQL/TiDB) A SUPABASE
// ----------------------------------------------------------------------------
// USO (una sola vez, con las tablas ya creadas: npm run db:migrar):
//   1. En tu .env define DATABASE_URL (Supabase, destino) y los datos de la base
//      antigua (origen):
//        ORIGEN_DB_HOST=...  ORIGEN_DB_USER=...  ORIGEN_DB_PASSWORD=...
//        ORIGEN_DB_NAME=...  ORIGEN_DB_PORT=4000  (TiDB usa 4000; MySQL 3306)
//      Para subir también los adjuntos viejos: SUPABASE_URL y SUPABASE_SERVICE_KEY.
//   2. Prueba sin escribir nada:   npm run migrar-datos -- --simular
//   3. Migra de verdad:            npm run migrar-datos
// QUÉ HACE
//   * Copia usuarios, permisos, máquinas, operarios, suministros, alertas,
//     notificaciones y auditoría, conservando los mismos números (id).
//   * SEPARA lo que antes estaba mezclado en registros_combustible:
//       - filas de "cierre del día"  -> tabla jornadas (una por día, cerrada)
//       - suministros a máquinas     -> tabla registros
//     El checklist del día pasa a la jornada. Las alertas de "inspección
//     pendiente" (que apuntaban a la fila de cierre) pasan a apuntar a la jornada.
//   * NO copia: sesiones (todos deberán volver a iniciar sesión), contadores de
//     login, la tabla de reportes (ahora se calcula sola) ni la configuración.
//   * Se niega a correr si el destino ya tiene datos (no duplica nada).
//   * Al terminar compara totales entre origen y destino.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { hashPassword, esHashSeguro } = require('../src/shared/infrastructure/security');

const fechaTexto = (v) => (v ? String(v).slice(0, 10) : null);
const marcaTiempo = (v) =>
  v
    ? String(v).replace(' ', 'T') +
      (String(v).includes('Z') || /[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z')
    : null;
const bool = (v) => v === true || Number(v) === 1;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ¿Esta fila de registros_combustible es un cierre del día? (misma regla que usaba
// la aplicación antigua, incluida la detección de registros históricos).
function esFilaDeCierre(r) {
  if (Number(r.cierre_dia) === 1) return true;
  const lecturas = [r.m1_inicial, r.m1_final, r.m2_inicial, r.m2_final];
  const completas = lecturas.every((x) => x !== null && x !== undefined && String(x).trim() !== '');
  const sinSuministro = !String(r.operario || '').trim() && !String(r.maquina || '').trim();
  return Number(r.cierre_dia) === 0 && completas && sinSuministro;
}

// Convierte las tablas antiguas (filas tal como salen de MySQL) en las tablas nuevas.
// Es una función PURA (sin base de datos), por eso se puede probar con datos de ejemplo.
function transformar(origen) {
  const resumen = { advertencias: [] };
  const usuarios = (origen.usuarios || []).map((u) => ({
    id: u.id,
    usuario: String(u.usuario).trim(),
    // Si por alguna razón quedó una contraseña sin cifrar, se cifra aquí.
    contrasena: esHashSeguro(u.contrasena) ? u.contrasena : hashPassword(String(u.contrasena)),
    rol: u.rol,
    debe_cambiar_contrasena: bool(u.debe_cambiar_contrasena),
    creado_en: marcaTiempo(u.creado_en)
  }));
  const idsUsuarios = new Set(usuarios.map((u) => u.id));
  const permisos = (origen.permisos || [])
    .filter((p) => idsUsuarios.has(p.usuario_id))
    .map((p) => ({
      id: p.id,
      usuario_id: p.usuario_id,
      vista: p.vista,
      creado_en: marcaTiempo(p.creado_en)
    }));

  const anulacion = (x) => ({
    estado: x.estado || 'ACTIVO',
    motivo_anulacion: x.motivo_anulacion || null,
    usuario_anulacion: x.usuario_anulacion || null,
    fecha_anulacion: marcaTiempo(x.fecha_anulacion)
  });
  const tractores = (origen.tractores || []).map((t) => ({
    id: t.id,
    item: t.item,
    maquina: t.maquina,
    descripcion: t.descripcion,
    centro_costo: t.centro_costo,
    capacidad_galones: num(t.capacidad_galones) ?? 0,
    ...anulacion(t)
  }));
  const operarios = (origen.operarios || []).map((o) => ({
    id: o.id,
    nombre: o.nombre,
    cedula: o.cedula,
    creado_en: marcaTiempo(o.creado_en),
    ...anulacion(o)
  }));

  // --- Separar cierres de suministros ---
  const cierres = []; // filas de cierre vigentes
  const suministros = [];
  let cierresAnulados = 0;
  for (const r of origen.registros || []) {
    if (esFilaDeCierre(r)) {
      if (r.estado === 'ANULADO') cierresAnulados += 1;
      else cierres.push(r);
    } else {
      suministros.push(r);
    }
  }
  const idsCierre = new Set((origen.registros || []).filter(esFilaDeCierre).map((r) => r.id));

  // Un cierre por fecha: si hubiera varios, se conserva el más reciente (mayor id).
  const cierrePorFecha = new Map();
  let cierresDuplicados = 0;
  for (const c of [...cierres].sort((a, b) => a.id - b.id)) {
    const f = fechaTexto(c.fecha);
    if (!f) continue;
    if (cierrePorFecha.has(f)) cierresDuplicados += 1;
    cierrePorFecha.set(f, c);
  }
  // El checklist del día estaba en "el primer registro que lo llenó" (cierre o suministro).
  const checklistPorFecha = new Map();
  for (const r of [...(origen.registros || [])].sort((a, b) => a.id - b.id)) {
    if (r.estado === 'ANULADO') continue;
    const f = fechaTexto(r.fecha);
    if (
      f &&
      !checklistPorFecha.has(f) &&
      (r.fuga_biodiesel || r.sistema_electrico || r.parada_emergencia)
    )
      checklistPorFecha.set(f, r);
  }
  const jornadas = [...cierrePorFecha.entries()].map(([fecha, c], i) => {
    const ch =
      c.fuga_biodiesel || c.sistema_electrico || c.parada_emergencia
        ? c
        : checklistPorFecha.get(fecha) || {};
    return {
      id: i + 1,
      fecha,
      m1_inicial: num(c.m1_inicial),
      m1_final: num(c.m1_final),
      m2_inicial: num(c.m2_inicial),
      m2_final: num(c.m2_final),
      galones_m1: num(c.galones_m1),
      galones_m2: num(c.galones_m2),
      total_galones: num(c.total_galones),
      fuga_biodiesel: ch.fuga_biodiesel || null,
      sistema_electrico: ch.sistema_electrico || null,
      parada_emergencia: ch.parada_emergencia || null,
      estado: 'cerrada',
      abierta_por: 'migración',
      abierta_en: marcaTiempo(c.registrado_en),
      actualizada_por: 'migración',
      actualizada_en: marcaTiempo(c.registrado_en),
      cerrada_por: 'migración',
      cerrada_en: marcaTiempo(c.registrado_en)
    };
  });
  const jornadaPorFecha = new Map(jornadas.map((j) => [j.fecha, j]));
  const jornadaPorIdCierre = new Map();
  for (const c of cierres) {
    const j = jornadaPorFecha.get(fechaTexto(c.fecha));
    if (j) jornadaPorIdCierre.set(c.id, j);
  }

  const sinFecha = [];
  const registros = [];
  for (const r of suministros) {
    if (!fechaTexto(r.fecha)) {
      sinFecha.push(r.id);
      continue;
    }
    registros.push({
      id: r.id,
      fecha: fechaTexto(r.fecha),
      operario: r.operario || null,
      cedula: r.cedula || null,
      maquina: r.maquina || null,
      horometro: r.horometro || null,
      cantidad: num(r.cantidad),
      numero_sai: r.numero_sai || null,
      firma: r.firma || null,
      observaciones: r.observaciones || null,
      registrado_por: null,
      registrado_en: marcaTiempo(r.registrado_en),
      ...anulacion(r)
    });
  }
  if (sinFecha.length)
    resumen.advertencias.push(
      `${sinFecha.length} suministro(s) sin fecha no se migraron (ids: ${sinFecha.slice(0, 10).join(', ')}).`
    );
  const idsRegistros = new Set(registros.map((r) => r.id));

  // --- Alertas: registro_id puede apuntar a un suministro (se conserva) o a una fila de cierre (pasa a jornada_id) ---
  let alertasReasignadas = 0;
  let alertasHuerfanas = 0;
  const alertas = (origen.alertas || []).map((a) => {
    let registro_id = a.registro_id || null;
    let jornada_id = null;
    if (registro_id && idsCierre.has(registro_id)) {
      const j = jornadaPorIdCierre.get(registro_id);
      if (j) {
        jornada_id = j.id;
        alertasReasignadas += 1;
      }
      registro_id = null;
    } else if (registro_id && !idsRegistros.has(registro_id)) {
      registro_id = null;
      alertasHuerfanas += 1;
    }
    return {
      id: a.id,
      registro_id,
      jornada_id,
      fecha: fechaTexto(a.fecha),
      maquina: a.maquina,
      operario: a.operario || null,
      cantidad: num(a.cantidad) ?? 0,
      capacidad_galones: num(a.capacidad_galones) ?? 0,
      exceso_galones: num(a.exceso_galones) ?? 0,
      observaciones: a.observaciones || null,
      justificacion: a.justificacion || null,
      estado: a.estado || 'pendiente',
      justificado_por: a.justificado_por || null,
      justificado_en: marcaTiempo(a.justificado_en),
      reporte_nombre: a.reporte_nombre || null,
      reporte_ruta: a.reporte_ruta || null,
      reporte_tipo: a.reporte_tipo || null,
      tipo_alerta: a.tipo_alerta || 'sobrecapacidad',
      promedio_galones: num(a.promedio_galones),
      porcentaje_sobre_promedio: num(a.porcentaje_sobre_promedio),
      detalle_alerta: a.detalle_alerta || null,
      valor_referencia: num(a.valor_referencia),
      creado_en: marcaTiempo(a.creado_en)
    };
  });
  // Índice único (registro, tipo) y (jornada, tipo): si el origen tenía repetidos, se descartan.
  const vistos = new Set();
  const alertasUnicas = alertas.filter((a) => {
    const claves = [
      a.registro_id && `r${a.registro_id}|${a.tipo_alerta}`,
      a.jornada_id && `j${a.jornada_id}|${a.tipo_alerta}`
    ].filter(Boolean);
    if (claves.some((k) => vistos.has(k))) return false;
    claves.forEach((k) => vistos.add(k));
    return true;
  });
  if (alertasUnicas.length !== alertas.length)
    resumen.advertencias.push(
      `${alertas.length - alertasUnicas.length} alerta(s) repetida(s) descartada(s).`
    );
  const idsAlertas = new Set(alertasUnicas.map((a) => a.id));

  const notificaciones = (origen.notificaciones || [])
    .filter((n) => idsAlertas.has(n.alerta_id))
    .map((n) => ({
      id: n.id,
      alerta_id: n.alerta_id,
      rol: n.rol,
      titulo: n.titulo,
      mensaje: n.mensaje,
      leida: bool(n.leida),
      creado_en: marcaTiempo(n.creado_en),
      leida_en: marcaTiempo(n.leida_en)
    }));

  const auditoria = (origen.auditoria || []).map((a) => {
    let detalle = a.detalle;
    if (typeof detalle === 'string') {
      try {
        detalle = JSON.parse(detalle);
      } catch (_) {
        detalle = { valor: detalle };
      }
    }
    return {
      id: a.id,
      usuario_id: idsUsuarios.has(a.usuario_id) ? a.usuario_id : null,
      usuario: a.usuario || null,
      rol: a.rol || null,
      accion: a.accion,
      modulo: a.modulo,
      registro_id: a.registro_id || null,
      detalle: detalle === null || detalle === undefined ? null : JSON.stringify(detalle),
      creado_en: marcaTiempo(a.creado_en)
    };
  });

  Object.assign(resumen, {
    cierresConvertidosEnJornadas: jornadas.length,
    cierresAnulados,
    cierresDuplicadosDescartados: cierresDuplicados,
    alertasReasignadasAJornada: alertasReasignadas,
    alertasConRegistroInexistente: alertasHuerfanas,
    // Total de control: solo lo que SÍ se migra (los suministros sin fecha quedan fuera y se advierten).
    totalSuministradoOrigen: registros
      .filter((r) => r.estado !== 'ANULADO')
      .reduce((t, r) => t + (r.cantidad || 0), 0),
    totalSurtidorOrigen: [...cierrePorFecha.values()].reduce(
      (t, c) => t + (num(c.total_galones) || 0),
      0
    )
  });

  return {
    tablas: {
      usuarios,
      permisos,
      tractores,
      operarios,
      jornadas,
      registros,
      alertas: alertasUnicas,
      notificaciones,
      auditoria
    },
    resumen
  };
}

// Orden de inserción (respeta las llaves foráneas) y columnas de cada tabla nueva.
const ORDEN = [
  ['usuarios', 'usuarios_combustible'],
  ['permisos', 'permisos_usuarios_combustible'],
  ['tractores', 'tractores'],
  ['operarios', 'operarios'],
  ['jornadas', 'jornadas_combustible'],
  ['registros', 'registros_combustible'],
  ['alertas', 'alertas_combustible'],
  ['notificaciones', 'notificaciones_combustible'],
  ['auditoria', 'auditoria_combustible']
];

async function insertarLote(tx, tabla, filas) {
  if (!filas.length) return;
  const columnas = Object.keys(filas[0]);
  const TAMANO = Math.max(1, Math.floor(30000 / columnas.length));
  for (let i = 0; i < filas.length; i += TAMANO) {
    const lote = filas.slice(i, i + TAMANO);
    const marcadores = lote.map(() => `(${columnas.map(() => '?').join(',')})`).join(',');
    await tx.query(
      `INSERT INTO ${tabla}(${columnas.join(',')}) VALUES ${marcadores}`,
      lote.flatMap((f) => columnas.map((c) => f[c]))
    );
  }
}

// Escribe las tablas nuevas en el destino (todo en UNA transacción: o entra todo o nada).
// reemplazarMaquinaria: borra la maquinaria de ejemplo (npm run db:sembrar) antes de copiar la real.
async function escribir(destino, tablas, { reemplazarMaquinaria = false } = {}) {
  await destino.transaction(async (tx) => {
    if (reemplazarMaquinaria) await tx.query('DELETE FROM tractores');
    for (const [clave, tabla] of ORDEN) await insertarLote(tx, tabla, tablas[clave]);
    // Las secuencias de los id continúan después del mayor id copiado.
    for (const [, tabla] of ORDEN)
      await tx.query(
        `SELECT setval(pg_get_serial_sequence('${tabla}','id'), COALESCE((SELECT MAX(id) FROM ${tabla}),1), (SELECT MAX(id) FROM ${tabla}) IS NOT NULL)`
      );
  });
}

// Compara totales entre lo esperado y lo que quedó en el destino.
async function verificar(destino, tablas, resumen) {
  const problemas = [];
  for (const [clave, tabla] of ORDEN) {
    const [f] = await destino.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
    if (f[0].n !== tablas[clave].length)
      problemas.push(`${tabla}: esperado ${tablas[clave].length}, en destino ${f[0].n}`);
  }
  const [s] = await destino.query(
    "SELECT COALESCE(SUM(cantidad),0) AS t FROM registros_combustible WHERE estado<>'ANULADO'"
  );
  if (Math.abs(Number(s[0].t) - resumen.totalSuministradoOrigen) > 0.01)
    problemas.push(
      `galones suministrados: origen ${resumen.totalSuministradoOrigen}, destino ${s[0].t}`
    );
  const [j] = await destino.query(
    'SELECT COALESCE(SUM(total_galones),0) AS t FROM jornadas_combustible'
  );
  if (Math.abs(Number(j[0].t) - resumen.totalSurtidorOrigen) > 0.01)
    problemas.push(
      `galones del surtidor: origen ${resumen.totalSurtidorOrigen}, destino ${j[0].t}`
    );
  return problemas;
}

// Sube los adjuntos antiguos (carpeta uploads/) a Supabase Storage y actualiza su ruta.
async function subirAdjuntosViejos(tablas, almacenamiento, raiz) {
  let subidos = 0;
  const faltantes = [];
  for (const a of tablas.alertas) {
    if (!a.reporte_ruta || !a.reporte_ruta.startsWith('/uploads/')) continue;
    const archivo = path.join(raiz, a.reporte_ruta.replace(/^\//, ''));
    if (!fs.existsSync(archivo)) {
      faltantes.push(a.reporte_ruta);
      continue;
    }
    a.reporte_ruta = await almacenamiento.guardar(fs.readFileSync(archivo), {
      nombre: a.reporte_nombre || path.basename(archivo),
      tipo: a.reporte_tipo || 'application/octet-stream'
    });
    subidos += 1;
  }
  return { subidos, faltantes };
}

async function leerOrigen(origen) {
  const q = async (sql) => (await origen.query(sql))[0];
  const existe = async (t) => (await q(`SHOW TABLES LIKE '${t}'`)).length > 0;
  return {
    usuarios: await q('SELECT * FROM usuarios_combustible'),
    permisos: await q('SELECT * FROM permisos_usuarios_combustible'),
    tractores: await q('SELECT * FROM tractores'),
    operarios: await q('SELECT * FROM operarios'),
    registros: await q('SELECT * FROM registros_combustible ORDER BY id'),
    alertas: (await existe('alertas_combustible'))
      ? await q('SELECT * FROM alertas_combustible ORDER BY id')
      : [],
    notificaciones: (await existe('notificaciones_combustible'))
      ? await q('SELECT * FROM notificaciones_combustible ORDER BY id')
      : [],
    auditoria: (await existe('auditoria_combustible'))
      ? await q('SELECT * FROM auditoria_combustible ORDER BY id')
      : []
  };
}

async function main() {
  const simular = process.argv.includes('--simular');
  const { crearBaseDeDatos } = require('../src/shared/infrastructure/db');
  const { crearAlmacenamiento } = require('../src/shared/infrastructure/storage');
  const mysql = require('mysql2/promise'); // Solo se necesita para esta migración (paquete de desarrollo)

  const host = process.env.ORIGEN_DB_HOST;
  if (!host || !process.env.ORIGEN_DB_NAME)
    throw new Error(
      'Faltan los datos de la base antigua: ORIGEN_DB_HOST, ORIGEN_DB_USER, ORIGEN_DB_PASSWORD, ORIGEN_DB_NAME (y ORIGEN_DB_PORT).'
    );
  const remoto = !['localhost', '127.0.0.1'].includes(host);
  const origen = await mysql.createConnection({
    host,
    user: process.env.ORIGEN_DB_USER,
    password: process.env.ORIGEN_DB_PASSWORD,
    database: process.env.ORIGEN_DB_NAME,
    port: Number(process.env.ORIGEN_DB_PORT) || (remoto ? 4000 : 3306),
    dateStrings: true, // Las fechas llegan como texto, sin desfases de zona horaria
    ssl: remoto ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
  });
  const destino = crearBaseDeDatos();

  try {
    console.log('Leyendo la base antigua…');
    const datos = await leerOrigen(origen);
    const { tablas, resumen } = transformar(datos);

    console.log('\nResumen de lo que se migrará:');
    for (const [clave] of ORDEN) console.log(`  ${clave.padEnd(15)} ${tablas[clave].length}`);
    console.log(
      `  (cierres convertidos en jornadas: ${resumen.cierresConvertidosEnJornadas}; anulados: ${resumen.cierresAnulados}; duplicados descartados: ${resumen.cierresDuplicadosDescartados})`
    );
    console.log(
      `  (alertas movidas de cierre a jornada: ${resumen.alertasReasignadasAJornada}; con registro inexistente: ${resumen.alertasConRegistroInexistente})`
    );
    resumen.advertencias.forEach((a) => console.log(`  ⚠ ${a}`));

    if (simular) {
      console.log('\nModo --simular: no se escribió nada. Quita --simular para migrar.');
      return;
    }

    const [ocupadas] = await destino.query(
      'SELECT (SELECT COUNT(*) FROM usuarios_combustible)::int AS u,(SELECT COUNT(*) FROM registros_combustible)::int AS r,(SELECT COUNT(*) FROM jornadas_combustible)::int AS j,(SELECT COUNT(*) FROM tractores)::int AS t'
    );
    const o = ocupadas[0];
    if (o.u || o.r || o.j)
      throw new Error(
        `El destino ya tiene datos (usuarios: ${o.u}, registros: ${o.r}, jornadas: ${o.j}). Para no duplicar, usa un proyecto de Supabase vacío.`
      );

    const almacenamiento = crearAlmacenamiento();
    if (almacenamiento.usaSupabase) {
      const { subidos, faltantes } = await subirAdjuntosViejos(
        tablas,
        almacenamiento,
        path.join(__dirname, '..')
      );
      console.log(`Adjuntos antiguos subidos a Storage: ${subidos}.`);
      faltantes.forEach((f) => console.log(`  ⚠ No se encontró el archivo ${f} en este equipo.`));
    } else {
      console.log(
        '• Sin SUPABASE_URL/SUPABASE_SERVICE_KEY: los adjuntos antiguos no se suben (las alertas conservan su texto).'
      );
    }

    console.log('Escribiendo en Supabase (una sola transacción)…');
    await escribir(destino, tablas, { reemplazarMaquinaria: o.t > 0 }); // La de ejemplo se reemplaza por la real
    const problemas = await verificar(destino, tablas, resumen);
    if (problemas.length) {
      console.error('\n✘ La verificación encontró diferencias:');
      problemas.forEach((p) => console.error('  - ' + p));
      process.exitCode = 1;
    } else {
      console.log('\n✔ Migración completa y verificada (conteos y totales de galones coinciden).');
      console.log('  Todos los usuarios deberán iniciar sesión de nuevo.');
    }
  } finally {
    await origen.end();
    await destino.close();
  }
}

module.exports = { transformar, escribir, verificar, esFilaDeCierre, subirAdjuntosViejos };

if (require.main === module)
  main().catch((error) => {
    console.error('✘ No se pudo migrar:', error.message);
    process.exit(1);
  });
