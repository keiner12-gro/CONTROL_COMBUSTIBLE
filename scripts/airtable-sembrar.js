// ============================================================================
// airtable-sembrar.js — DATOS INICIALES EN AIRTABLE (npm run airtable:sembrar)
// ----------------------------------------------------------------------------
// Es el equivalente de "npm run db:sembrar" pero para Airtable:
//  1. Catálogo de maquinaria (data/maquinaria.json), solo si la tabla está vacía.
//  2. Primer usuario super administrador, solo si no existe ningún usuario.
//     Se define con variables de entorno (NO se escribe en el código):
//       ADMIN_USUARIO=admin   ADMIN_CONTRASENA=una_clave_temporal
// Es seguro repetirlo: no duplica nada. Requiere que las tablas ya existan
// (correr antes: npm run airtable:migrar).
// ============================================================================

const fs = require('fs');
const path = require('path');
const { crearClienteAirtable } = require('../src/shared/infrastructure/airtable-client');
const { hashPassword } = require('../src/shared/infrastructure/security');

// Recibe el cliente ya armado, para poder probar esta función sin red real
// (ver test/airtable-sembrar.test.js).
async function sembrar(cliente) {
  // --- 1) Maquinaria ---
  const maquinasActuales = await cliente.listar('tractores');
  if (maquinasActuales.length === 0) {
    const archivo = path.join(__dirname, '../data/maquinaria.json');
    const lista = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : [];
    if (lista.length)
      await cliente.crear(
        'tractores',
        lista.map((e) => ({
          item: e.item,
          maquina: e.maquina,
          descripcion: e.descripcion,
          centro_costo: e.centro_costo,
          capacidad_galones: e.capacidad_galones,
          estado: 'ACTIVO'
        }))
      );
    console.log(`✔ Maquinaria cargada: ${lista.length} equipos.`);
  } else {
    console.log(`• Maquinaria: ya hay ${maquinasActuales.length} equipos, no se toca.`);
  }

  // --- 2) Primer administrador ---
  const usuariosActuales = await cliente.listar('usuarios_combustible');
  if (usuariosActuales.length === 0) {
    const usuario = String(process.env.ADMIN_USUARIO || '')
      .trim()
      .toLowerCase();
    const contrasena = String(process.env.ADMIN_CONTRASENA || '');
    if (usuario.length < 3 || contrasena.length < 8) {
      console.log(
        '• Usuarios: no hay ninguno. Define ADMIN_USUARIO (mín. 3 letras) y ADMIN_CONTRASENA (mín. 8) y vuelve a ejecutar.'
      );
    } else {
      await cliente.crear('usuarios_combustible', [
        {
          usuario,
          contrasena: hashPassword(contrasena),
          rol: 'super_administrador',
          debe_cambiar_contrasena: true,
          creado_en: new Date().toISOString()
        }
      ]);
      console.log(
        `✔ Super administrador "${usuario}" creado (deberá cambiar la contraseña al entrar).`
      );
    }
  } else {
    console.log(`• Usuarios: ya hay ${usuariosActuales.length}, no se toca.`);
  }
}

async function main() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId)
    throw new Error('Faltan AIRTABLE_API_KEY y/o AIRTABLE_BASE_ID en tu .env.');
  await sembrar(crearClienteAirtable({ apiKey, baseId }));
}

module.exports = { sembrar };

if (require.main === module) {
  require('dotenv').config();
  main().catch((error) => {
    console.error('✘ No se pudieron cargar los datos iniciales:', error.message);
    process.exit(1);
  });
}
