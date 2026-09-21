// ============================================================================
// importar-operarios.js — CARGA OPERARIOS DESDE UN ARCHIVO CSV
// ----------------------------------------------------------------------------
// USO:   npm run importar-operarios -- ruta/operarios.csv            (carga)
//        npm run importar-operarios -- ruta/operarios.csv --simular   (solo muestra el resumen)
// El CSV debe tener una fila de encabezado con las columnas  nombre,cedula
// (separadas por coma o punto y coma). Desde Excel: Guardar como > CSV UTF-8.
// Reglas: el nombre se guarda en MAYÚSCULAS; se ignoran filas vacías y las
// cédulas que ya existen entre los operarios activos (no duplica nada).
// Todo se carga en una sola transacción: o entran todos o ninguno.
// ============================================================================

const fs = require('fs');
const { crearBaseDeDatos } = require('../src/shared/infrastructure/db');

// Lector de CSV mínimo: soporta comillas, comas o punto y coma como separador.
function leerCsv(texto) {
  const contenido = texto.replace(/^﻿/, '');
  const separador =
    (contenido.split('\n')[0].match(/;/g) || []).length >
    (contenido.split('\n')[0].match(/,/g) || []).length
      ? ';'
      : ',';
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];
    if (comillas) {
      if (c === '"' && contenido[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && contenido[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

// Convierte las filas del CSV en operarios limpios y separa los problemas.
function prepararOperarios(filas) {
  const [encabezado, ...datos] = filas;
  const columnas = encabezado.map((h) => h.trim().toLowerCase());
  const iNombre = columnas.indexOf('nombre');
  const iCedula = columnas.findIndex((h) => h === 'cedula' || h === 'cédula');
  if (iNombre < 0 || iCedula < 0)
    throw new Error('El CSV debe tener las columnas "nombre" y "cedula" en la primera fila.');
  const validos = [];
  const problemas = [];
  const vistas = new Set();
  datos.forEach((f, i) => {
    const nombre = String(f[iNombre] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    const cedula = String(f[iCedula] || '').replace(/\D/g, '');
    if (!nombre || !cedula) return problemas.push(`fila ${i + 2}: falta nombre o cédula`);
    if (vistas.has(cedula)) return problemas.push(`fila ${i + 2}: cédula repetida en el archivo`);
    vistas.add(cedula);
    validos.push({ nombre, cedula });
  });
  return { validos, problemas };
}

async function main() {
  const ruta = process.argv[2];
  const simular = process.argv.includes('--simular');
  if (!ruta || ruta.startsWith('--'))
    throw new Error('Indica el archivo: npm run importar-operarios -- operarios.csv');
  const { validos, problemas } = prepararOperarios(leerCsv(fs.readFileSync(ruta, 'utf8')));

  const db = crearBaseDeDatos();
  try {
    const [existentes] = await db.query("SELECT cedula FROM operarios WHERE estado<>'ANULADO'");
    const yaEstan = new Set(existentes.map((o) => String(o.cedula).replace(/\D/g, '')));
    const nuevos = validos.filter((o) => !yaEstan.has(o.cedula));
    console.log(
      `Filas válidas: ${validos.length} | ya existían: ${validos.length - nuevos.length} | por cargar: ${nuevos.length}`
    );
    problemas.forEach((p) => console.log('  ⚠ ' + p));
    if (simular) return console.log('Modo --simular: no se escribió nada.');
    await db.transaction(async (tx) => {
      for (const o of nuevos)
        await tx.query('INSERT INTO operarios(nombre,cedula) VALUES(?,?)', [o.nombre, o.cedula]);
    });
    const [total] = await db.query(
      "SELECT COUNT(*)::int AS n FROM operarios WHERE estado<>'ANULADO'"
    );
    console.log(`✔ Operarios cargados: ${nuevos.length}. Total activos ahora: ${total[0].n}.`);
  } finally {
    await db.close();
  }
}

module.exports = { leerCsv, prepararOperarios };

if (require.main === module)
  main().catch((error) => {
    console.error('✘ No se pudo importar:', error.message);
    process.exit(1);
  });
