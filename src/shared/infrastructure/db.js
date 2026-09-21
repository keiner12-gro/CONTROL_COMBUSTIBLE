// ============================================================================
// db.js — CONEXIÓN A LA BASE DE DATOS (PostgreSQL / Supabase)
// ----------------------------------------------------------------------------
// Todos los repositorios reciben el objeto que devuelve crearBaseDeDatos() y
// solo usan dos cosas:
//   db.query(sql, params)      -> [filas, { rowCount }]   (parámetros con "?")
//   db.transaction(async tx => ...) -> todo o nada; tx tiene el mismo query()
// PARA CAMBIAR DE CUENTA/PROYECTO DE SUPABASE no se toca código: solo la
// variable DATABASE_URL (ver .env.example y docs/GUIA-SUPABASE.md).
// Motores soportados:
//   * DATABASE_URL  -> PostgreSQL real (Supabase, producción y desarrollo)
//   * DB_DRIVER=pglite -> Postgres embebido, solo para pruebas locales sin
//     internet (paquete de desarrollo @electric-sql/pglite).
// ============================================================================

require('dotenv').config(); // Carga el .env por si este módulo se usa suelto

// Convierte los "?" de estilo MySQL en $1, $2... de PostgreSQL. Ignora los "?"
// que estén dentro de textos entre comillas simples o dobles.
function convertirMarcadores(sql) {
  let salida = '';
  let n = 0;
  let comilla = null; // Comilla que está abierta en este momento (' o ")
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (comilla) {
      salida += c;
      if (c === comilla) comilla = null;
    } else if (c === "'" || c === '"') {
      comilla = c;
      salida += c;
    } else if (c === '?') {
      salida += `$${++n}`;
    } else {
      salida += c;
    }
  }
  return salida;
}

// Envuelve cualquier "ejecutor" (pool, cliente o PGlite) con la interfaz común.
// "opciones" solo lo usa PGlite (convertidores de tipos por consulta).
function envolver(ejecutor, opciones) {
  return {
    async query(sql, params = []) {
      const texto = convertirMarcadores(sql);
      const resultado = opciones
        ? await ejecutor.query(texto, params, opciones)
        : await ejecutor.query(texto, params);
      return [resultado.rows, { rowCount: resultado.rowCount ?? resultado.affectedRows ?? 0 }];
    }
  };
}

function crearConPostgres() {
  const { Pool, types } = require('pg');
  // DATE llega como texto "YYYY-MM-DD" (evita desfases de zona horaria) y los
  // enteros grandes (auditoría, sesiones) como número normal de JavaScript.
  types.setTypeParser(1082, (valor) => valor);
  types.setTypeParser(20, (valor) => Number(valor));

  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'Falta DATABASE_URL. Copia .env.example a .env y pega la cadena de conexión de Supabase.'
    );
  const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({
    connectionString: url,
    // Vercel crea muchas instancias pequeñas: pocas conexiones por instancia.
    max: Number(process.env.DB_POOL_MAX) || 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    // Supabase exige SSL. Si tienes el certificado raíz, pon su texto en
    // DATABASE_SSL_CA para verificarlo; si no, se cifra sin verificar el emisor.
    ssl: esLocal
      ? undefined
      : process.env.DATABASE_SSL_CA
        ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true }
        : { rejectUnauthorized: false }
  });
  pool.on('error', (error) => console.error('Error en el pool de PostgreSQL:', error.message));

  const base = envolver(pool);
  base.transaction = async (funcion) => {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await funcion(envolver(cliente));
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      cliente.release();
    }
  };
  // Ejecuta un script SQL completo (varias sentencias), p. ej. supabase/schema.sql.
  base.exec = async (script) => {
    await pool.query(script);
  };
  base.close = () => pool.end();
  base.driver = 'postgres';
  return base;
}

function crearConPglite() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('DB_DRIVER=pglite es solo para pruebas locales, no para producción.');
  const { PGlite, types } = require('@electric-sql/pglite');
  const motor = new PGlite(process.env.PGLITE_DIR || undefined);
  const opciones = {
    parsers: {
      [types.DATE]: (valor) => valor, // Igual que con pg: fechas como texto
      [types.NUMERIC]: (valor) => valor, // DECIMAL como texto (igual que pg)
      [types.INT8]: (valor) => Number(valor)
    }
  };
  const base = envolver(motor, opciones);
  base.transaction = async (funcion) => {
    // PGlite es una sola conexión: se serializa para que dos transacciones no se mezclen.
    return motor.transaction(async (tx) => funcion(envolver(tx, opciones)));
  };
  base.exec = async (script) => {
    await motor.exec(script);
  };
  base.close = () => motor.close();
  base.driver = 'pglite';
  base.motor = motor;
  return base;
}

function crearBaseDeDatos() {
  return process.env.DB_DRIVER === 'pglite' ? crearConPglite() : crearConPostgres();
}

module.exports = { crearBaseDeDatos, convertirMarcadores };
