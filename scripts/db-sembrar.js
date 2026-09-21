// ============================================================================
// db-sembrar.js — DATOS INICIALES (npm run db:sembrar)
// ----------------------------------------------------------------------------
//  1. Catálogo de maquinaria (data/maquinaria.json), solo si la tabla está vacía.
//  2. Primer usuario super administrador, solo si no existe ningún usuario.
//     Se define con variables de entorno (NO se escribe en el código):
//       ADMIN_USUARIO=admin   ADMIN_CONTRASENA=una_clave_temporal
//     Se le obliga a cambiar la contraseña en su primer ingreso.
// Es seguro repetirlo: no duplica nada.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { crearBaseDeDatos } = require('../src/shared/infrastructure/db');
const { hashPassword } = require('../src/shared/infrastructure/security');

// Carga los datos iniciales sobre una base ya abierta (imprime lo que hace).
async function sembrar(db) {
  {
    // --- 1) Maquinaria ---
    const [[{ total: maquinas }]] = await db.query('SELECT COUNT(*)::int AS total FROM tractores');
    if (maquinas === 0) {
      const archivo = path.join(__dirname, '../data/maquinaria.json');
      const lista = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : [];
      await db.transaction(async (tx) => {
        for (const e of lista)
          await tx.query(
            'INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?)',
            [e.item, e.maquina, e.descripcion, e.centro_costo, e.capacidad_galones]
          );
      });
      console.log(`✔ Maquinaria cargada: ${lista.length} equipos.`);
    } else {
      console.log(`• Maquinaria: ya hay ${maquinas} equipos, no se toca.`);
    }

    // --- 2) Primer administrador ---
    const [[{ total: usuarios }]] = await db.query(
      'SELECT COUNT(*)::int AS total FROM usuarios_combustible'
    );
    if (usuarios === 0) {
      const usuario = String(process.env.ADMIN_USUARIO || '')
        .trim()
        .toLowerCase();
      const contrasena = String(process.env.ADMIN_CONTRASENA || '');
      if (usuario.length < 3 || contrasena.length < 8) {
        console.log(
          '• Usuarios: no hay ninguno. Define ADMIN_USUARIO (mín. 3 letras) y ADMIN_CONTRASENA (mín. 8) y vuelve a ejecutar.'
        );
      } else {
        await db.query(
          'INSERT INTO usuarios_combustible(usuario,contrasena,rol,debe_cambiar_contrasena) VALUES(?,?,?,TRUE)',
          [usuario, hashPassword(contrasena), 'super_administrador']
        );
        console.log(
          `✔ Super administrador "${usuario}" creado (deberá cambiar la contraseña al entrar).`
        );
      }
    } else {
      console.log(`• Usuarios: ya hay ${usuarios}, no se toca.`);
    }
  }
}

async function main() {
  const db = crearBaseDeDatos();
  try {
    await sembrar(db);
  } finally {
    await db.close();
  }
}

module.exports = { sembrar };

if (require.main === module)
  main().catch((error) => {
    console.error('✘ No se pudieron cargar los datos iniciales:', error.message);
    process.exit(1);
  });
