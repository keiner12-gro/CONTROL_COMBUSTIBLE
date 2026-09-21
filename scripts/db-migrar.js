// ============================================================================
// db-migrar.js — CREA/ACTUALIZA LAS TABLAS (npm run db:migrar)
// ----------------------------------------------------------------------------
// Ejecuta supabase/schema.sql sobre la base indicada en DATABASE_URL.
// Es seguro repetirlo: el archivo solo crea lo que falta.
// Equivale a pegar supabase/schema.sql en Supabase -> SQL Editor -> Run.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { crearBaseDeDatos } = require('../src/shared/infrastructure/db');

// Aplica el esquema sobre una base ya abierta y devuelve cuántas tablas tiene.
async function aplicarEsquema(db) {
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
  await db.exec(sql);
  const [tablas] = await db.query(
    "SELECT COUNT(*)::int AS total FROM information_schema.tables WHERE table_schema='public'"
  );
  return tablas[0].total;
}

async function main() {
  const db = crearBaseDeDatos();
  try {
    const total = await aplicarEsquema(db);
    console.log(`✔ Esquema aplicado (${db.driver}). Tablas en la base: ${total}.`);
  } finally {
    await db.close();
  }
}

module.exports = { aplicarEsquema };

if (require.main === module)
  main().catch((error) => {
    console.error('✘ No se pudo aplicar el esquema:', error.message);
    process.exit(1);
  });
