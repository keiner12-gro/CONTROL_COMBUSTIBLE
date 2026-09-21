// ============================================================================
// dev-local.js — PROBAR LA APP EN LOCAL SIN SUPABASE (npm run dev:local)
// ----------------------------------------------------------------------------
// Levanta la aplicación completa con un PostgreSQL embebido (PGlite) que
// guarda sus datos en la carpeta .pglite-data/ (no se sube a git). Sirve para
// desarrollar y probar sin internet ni cuenta de Supabase.
// Crea usuarios de DEMOSTRACIÓN (solo en local):
//    admin / operario / supervisor   con la contraseña  demo1234
// ============================================================================

const path = require('path');
process.env.DB_DRIVER = 'pglite';
process.env.PGLITE_DIR = process.env.PGLITE_DIR || path.join(__dirname, '../.pglite-data');
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const app = require('../server');
const { aplicarEsquema } = require('./db-migrar');
const { sembrar } = require('./db-sembrar');
const { hashPassword } = require('../src/shared/infrastructure/security');

async function main() {
  const db = app.locals.db;
  await aplicarEsquema(db);
  await sembrar(db);

  // Usuarios de demostración (si no existen).
  const demo = [
    ['admin', 'super_administrador', []],
    [
      'supervisor',
      'supervisor',
      ['registro', 'tablas', 'reportes', 'alertas', 'auditoria', 'tractores', 'operarios']
    ],
    ['operario', 'operario', ['registro']]
  ];
  for (const [usuario, rol, vistas] of demo) {
    const [existe] = await db.query('SELECT id FROM usuarios_combustible WHERE usuario=?', [
      usuario
    ]);
    if (existe.length) continue;
    const [nuevo] = await db.query(
      'INSERT INTO usuarios_combustible(usuario,contrasena,rol) VALUES(?,?,?) RETURNING id',
      [usuario, hashPassword('demo1234'), rol]
    );
    for (const vista of vistas)
      await db.query('INSERT INTO permisos_usuarios_combustible(usuario_id,vista) VALUES(?,?)', [
        nuevo[0].id,
        vista
      ]);
  }
  const [ops] = await db.query('SELECT COUNT(*)::int AS n FROM operarios');
  if (ops[0].n === 0)
    for (const [nombre, cedula] of [
      ['JUAN PEREZ', '1001'],
      ['MARIA GOMEZ', '1002']
    ])
      await db.query('INSERT INTO operarios(nombre,cedula) VALUES(?,?)', [nombre, cedula]);

  const puerto = Number(process.env.PUERTO || process.env.PORT || 3000);
  app.listen(puerto, () => {
    console.log(`\nApp local (PostgreSQL embebido) en http://localhost:${puerto}`);
    console.log('Usuarios de demostración: admin / supervisor / operario — contraseña: demo1234\n');
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
