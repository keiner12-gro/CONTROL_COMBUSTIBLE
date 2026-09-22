// ============================================================================
// airtable-migrar.js — CREA LAS TABLAS EN UNA BASE DE AIRTABLE (npm run airtable:migrar)
// ----------------------------------------------------------------------------
// Es el equivalente de "npm run db:migrar" pero para Airtable: lee
// airtable/schema.js y crea las tablas y columnas que falten dentro de la base
// indicada por AIRTABLE_BASE_ID. Es IDEMPOTENTE (se puede correr varias veces):
// una tabla que ya existe no se vuelve a crear, y solo se agregan las columnas
// que falten.
// REQUISITOS PREVIOS (una sola vez, a mano en airtable.com):
//   1. Crear una base VACÍA (un clic: "+ Create" -> "Start from scratch").
//   2. Copiar su Base ID de la URL (empieza por "app...") -> AIRTABLE_BASE_ID.
//   3. Crear un Personal Access Token en airtable.com/create/tokens con los
//      alcances: data.records:read, data.records:write, schema.bases:read,
//      schema.bases:write — y acceso a esa base -> AIRTABLE_API_KEY.
// Guía completa: docs/GUIA-AIRTABLE.md
// ============================================================================

require('dotenv').config();
const { TABLAS } = require('../airtable/schema');

// "fetchImpl" se puede reemplazar en las pruebas (test/airtable-migrar.test.js)
// para no depender de una cuenta real de Airtable.
async function main({ fetchImpl = globalThis.fetch } = {}) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId)
    throw new Error('Faltan AIRTABLE_API_KEY y/o AIRTABLE_BASE_ID en tu .env.');

  const cabeceras = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  const metaUrl = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;

  async function pedir(url, opciones) {
    const respuesta = await fetchImpl(url, { headers: cabeceras, ...opciones });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok)
      throw new Error(cuerpo?.error?.message || `Airtable respondió ${respuesta.status}`);
    return cuerpo;
  }

  const existentes = (await pedir(metaUrl)).tables; // [{id, name, fields:[{name,...}], ...}]

  for (const [nombreTabla, campos] of Object.entries(TABLAS)) {
    const tablaExistente = existentes.find((t) => t.name === nombreTabla);

    if (!tablaExistente) {
      await pedir(metaUrl, {
        method: 'POST',
        body: JSON.stringify({ name: nombreTabla, fields: campos })
      });
      console.log(`✔ Tabla creada: ${nombreTabla} (${campos.length} columnas)`);
      continue;
    }

    // La tabla ya existe: se agregan solo las columnas que falten.
    const nombresActuales = new Set(tablaExistente.fields.map((f) => f.name));
    const faltantes = campos.filter((c) => !nombresActuales.has(c.name));
    for (const campo of faltantes) {
      await pedir(`${metaUrl}/${tablaExistente.id}/fields`, {
        method: 'POST',
        body: JSON.stringify(campo)
      });
    }
    console.log(
      faltantes.length
        ? `✔ Tabla ${nombreTabla}: se agregaron ${faltantes.length} columna(s) nueva(s) (${faltantes.map((f) => f.name).join(', ')}).`
        : `• Tabla ${nombreTabla}: ya estaba al día.`
    );
  }

  console.log('\n✔ Esquema de Airtable listo.');
}

if (require.main === module)
  main().catch((error) => {
    console.error('✘ No se pudo preparar la base de Airtable:', error.message);
    process.exit(1);
  });

module.exports = { main };
