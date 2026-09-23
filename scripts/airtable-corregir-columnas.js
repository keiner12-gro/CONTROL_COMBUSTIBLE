// ============================================================================
// airtable-corregir-columnas.js — CORRIGE COLUMNAS CREADAS A MANO CON TIPO
// INCORRECTO (uso único: node scripts/airtable-corregir-columnas.js)
// ----------------------------------------------------------------------------
// La app guarda los ids de Airtable ("rec...") como TEXTO en las columnas
// usuario_id / registro_id / jornada_id / alerta_id. Si se crearon como
// "Link to another record" o "Number", el login, los permisos y la auditoría
// fallan. La API de Airtable no deja cambiar el tipo de una columna, así que:
//   1. renombra la columna actual a "<nombre>_viejo" (no se borra nada),
//   2. crea "<nombre>" como Single line text,
//   3. copia los valores (de un enlace copia el id "rec..." del registro).
// Es seguro repetirlo: una columna que ya es texto se salta.
// ============================================================================

require('dotenv').config({ quiet: true });

const CAMBIOS = [
  ['permisos_usuarios_combustible', 'usuario_id'],
  ['sesiones_combustible', 'usuario_id'],
  ['suscripciones_push', 'usuario_id'],
  ['auditoria_combustible', 'usuario_id'],
  ['auditoria_combustible', 'registro_id'],
  ['alertas_combustible', 'registro_id'],
  ['alertas_combustible', 'jornada_id'],
  ['notificaciones_combustible', 'alerta_id'],
  ['registros_combustible', 'horometro']
];

const { AIRTABLE_API_KEY: clave, AIRTABLE_BASE_ID: base } = process.env;

async function api(metodo, ruta, cuerpo) {
  await new Promise((r) => setTimeout(r, 250)); // Límite de ~5 peticiones/segundo
  const respuesta = await fetch(`https://api.airtable.com/v0/${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: cuerpo && JSON.stringify(cuerpo)
  });
  const datos = await respuesta.json();
  if (!respuesta.ok)
    throw new Error(`${metodo} ${ruta} → ${respuesta.status} ${JSON.stringify(datos.error)}`);
  return datos;
}

async function main() {
  if (!clave || !base) throw new Error('Faltan AIRTABLE_API_KEY y/o AIRTABLE_BASE_ID en tu .env.');
  const { tables } = await api('GET', `meta/bases/${base}/tables`);

  for (const [nombreTabla, columna] of CAMBIOS) {
    const tabla = tables.find((t) => t.name === nombreTabla);
    const campo = tabla?.fields.find((f) => f.name === columna);
    if (!campo) {
      console.log(`• No existe ${nombreTabla}.${columna}, se salta.`);
      continue;
    }
    if (campo.type === 'singleLineText') {
      console.log(`• ${nombreTabla}.${columna} ya es texto.`);
      continue;
    }

    await api('PATCH', `meta/bases/${base}/tables/${tabla.id}/fields/${campo.id}`, {
      name: `${columna}_viejo`
    });
    await api('POST', `meta/bases/${base}/tables/${tabla.id}/fields`, {
      name: columna,
      type: 'singleLineText'
    });

    const filas = [];
    let offset;
    do {
      const pagina = await api(
        'GET',
        `${base}/${tabla.id}?pageSize=100&returnFieldsByFieldId=true${offset ? `&offset=${offset}` : ''}`
      );
      filas.push(...pagina.records);
      offset = pagina.offset;
    } while (offset);

    const cambios = filas
      .map((fila) => {
        const valor = fila.fields[campo.id];
        if (valor == null || (Array.isArray(valor) && !valor.length)) return null;
        return { id: fila.id, fields: { [columna]: String(Array.isArray(valor) ? valor[0] : valor) } };
      })
      .filter(Boolean);
    for (let i = 0; i < cambios.length; i += 10)
      await api('PATCH', `${base}/${tabla.id}`, { records: cambios.slice(i, i + 10) });

    console.log(`✔ ${nombreTabla}.${columna} → texto (${cambios.length} valores copiados).`);
  }
}

main().catch((error) => {
  console.error('✘', error.message);
  process.exit(1);
});
