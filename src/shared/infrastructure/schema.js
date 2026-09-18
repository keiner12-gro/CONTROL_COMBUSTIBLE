// ============================================================================
// schema.js — CREACIÓN Y ACTUALIZACIÓN AUTOMÁTICA DE LA BASE DE DATOS
// ----------------------------------------------------------------------------
// Se ejecuta en cada arranque del servidor (ver server.js). Es "idempotente":
// se puede correr mil veces sin romper nada, porque usa CREATE TABLE IF NOT
// EXISTS y añade columnas solo si faltan.
// SI NECESITAS UNA COLUMNA NUEVA: agrégala aquí con agregarColumnaSiFalta(...)
// y se creará sola en local y en producción sin ejecutar SQL a mano.
// ============================================================================

const fs = require('fs'); // Lectura de archivos (data/maquinaria.json)
const path = require('path'); // Construcción de rutas del sistema de archivos
const { hashPassword, esHashSeguro } = require('./security'); // Para migrar contraseñas antiguas

// Versión del esquema. SUBE ESTE VALOR cada vez que agregues tablas/columnas
// en prepararTablas(): el arranque compara con la versión guardada en la base
// y, si ya coincide, se salta todo el trabajo (arranques en frío rápidos en Vercel).
const VERSION_ESQUEMA = '2026-09-18-a';

async function prepararTablas(db) {
  // La tabla de configuración se crea primero: guarda la versión del esquema.
  await db.query(
    `CREATE TABLE IF NOT EXISTS configuracion_combustible(clave VARCHAR(100) PRIMARY KEY,valor VARCHAR(255) NOT NULL)`
  );
  const [versionGuardada] = await db.query(
    `SELECT valor FROM configuracion_combustible WHERE clave='schema_version' LIMIT 1`
  );
  if (versionGuardada[0]?.valor === VERSION_ESQUEMA) return; // Esquema al día: nada que hacer

  // Helper: agrega una columna e ignora el error si ya existe.
  // Es la forma de "migrar" el esquema sin scripts manuales.
  const agregarColumnaSiFalta = async (tabla, columna, definicion) => {
    try {
      await db.query(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') throw error; // ER_DUP_FIELDNAME = la columna ya estaba
    }
  };

  // --- TABLA usuarios_combustible: cuentas de acceso al sistema -------------
  await db.query(
    `CREATE TABLE IF NOT EXISTS usuarios_combustible(id INT AUTO_INCREMENT PRIMARY KEY,usuario VARCHAR(80) NOT NULL UNIQUE,contrasena VARCHAR(120) NOT NULL,rol VARCHAR(40) NOT NULL,debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  );
  // Bandera que obliga a cambiar la contraseña en el primer ingreso.
  await agregarColumnaSiFalta(
    'usuarios_combustible',
    'debe_cambiar_contrasena',
    'TINYINT(1) NOT NULL DEFAULT 0'
  );
  // El hash scrypt es más largo que 120 caracteres: se amplía la columna.
  await db.query(`ALTER TABLE usuarios_combustible MODIFY COLUMN contrasena VARCHAR(255) NOT NULL`);

  // Migración de seguridad: si quedan contraseñas guardadas en texto plano
  // (versiones viejas del sistema), se convierten a hash scrypt al arrancar.
  const [usuariosExistentes] = await db.query('SELECT id,contrasena FROM usuarios_combustible');
  for (const usuario of usuariosExistentes) {
    if (!esHashSeguro(usuario.contrasena)) {
      await db.query('UPDATE usuarios_combustible SET contrasena=? WHERE id=?', [
        hashPassword(usuario.contrasena),
        usuario.id
      ]);
    }
  }

  // --- TABLA registros_combustible: el corazón del sistema ------------------
  // Guarda cada carga diaria: lecturas de los medidores (m1/m2), galones
  // calculados, chequeos de seguridad, datos del operario, máquina y firma.
  await db.query(
    `CREATE TABLE IF NOT EXISTS registros_combustible(id INT AUTO_INCREMENT PRIMARY KEY,fecha DATE,m1_inicial DECIMAL(12,2),m1_final DECIMAL(12,2),m2_inicial DECIMAL(12,2),m2_final DECIMAL(12,2),galones_m1 DECIMAL(12,2),galones_m2 DECIMAL(12,2),total_galones DECIMAL(12,2),fuga_biodiesel VARCHAR(20),sistema_electrico VARCHAR(30),parada_emergencia VARCHAR(30),cierre_dia TINYINT(1) DEFAULT 0,operario VARCHAR(120),cedula VARCHAR(30),maquina VARCHAR(80),horometro VARCHAR(120),cantidad DECIMAL(12,2),numero_sai VARCHAR(80),firma LONGTEXT,observaciones TEXT,registrado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  );
  // Los registros historicos ya no se eliminan fisicamente: "estado" ANULADO
  // reemplaza al DELETE, conservando el dato y quien/cuando/por que se anulo.
  await agregarColumnaSiFalta(
    'registros_combustible',
    'estado',
    "VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'" // ACTIVO | ANULADO
  );
  await agregarColumnaSiFalta('registros_combustible', 'motivo_anulacion', 'VARCHAR(255) NULL');
  await agregarColumnaSiFalta('registros_combustible', 'usuario_anulacion', 'VARCHAR(80) NULL');
  await agregarColumnaSiFalta('registros_combustible', 'fecha_anulacion', 'DATETIME NULL');

  // --- TABLA permisos_usuarios_combustible: qué vista puede ver cada usuario -
  // La clave única evita permisos duplicados y el ON DELETE CASCADE borra los
  // permisos automáticamente al eliminar el usuario.
  await db.query(
    `CREATE TABLE IF NOT EXISTS permisos_usuarios_combustible(id INT AUTO_INCREMENT PRIMARY KEY,usuario_id INT NOT NULL,vista VARCHAR(40) NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY permiso_unico (usuario_id,vista),FOREIGN KEY (usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE)`
  );

  // --- TABLA tractores: catálogo de maquinaria ------------------------------
  // capacidad_galones es clave: con ella se detectan las alertas de sobrecarga.
  await db.query(
    `CREATE TABLE IF NOT EXISTS tractores(id INT AUTO_INCREMENT PRIMARY KEY,item INT NOT NULL,maquina VARCHAR(20) NOT NULL,descripcion VARCHAR(150) NOT NULL,centro_costo VARCHAR(20) NOT NULL,capacidad_galones DECIMAL(12,2) DEFAULT 0)`
  );
  await agregarColumnaSiFalta('tractores', 'capacidad_galones', 'DECIMAL(12,2) DEFAULT 0');
  // Mismo esquema de anulación lógica que en los registros.
  await agregarColumnaSiFalta('tractores', 'estado', "VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'");
  await agregarColumnaSiFalta('tractores', 'motivo_anulacion', 'VARCHAR(255) NULL');
  await agregarColumnaSiFalta('tractores', 'usuario_anulacion', 'VARCHAR(80) NULL');
  await agregarColumnaSiFalta('tractores', 'fecha_anulacion', 'DATETIME NULL');

  // --- TABLA operarios: personas que cargan combustible ---------------------
  await db.query(
    `CREATE TABLE IF NOT EXISTS operarios(id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(120) NOT NULL,cedula VARCHAR(30) NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  );
  await agregarColumnaSiFalta('operarios', 'estado', "VARCHAR(20) NOT NULL DEFAULT 'ACTIVO'");
  await agregarColumnaSiFalta('operarios', 'motivo_anulacion', 'VARCHAR(255) NULL');
  await agregarColumnaSiFalta('operarios', 'usuario_anulacion', 'VARCHAR(80) NULL');
  await agregarColumnaSiFalta('operarios', 'fecha_anulacion', 'DATETIME NULL');

  // --- TABLA reportes_combustible: un cierre por mes ------------------------
  // La clave única (anio,mes) impide cerrar dos veces el mismo mes.
  await db.query(
    `CREATE TABLE IF NOT EXISTS reportes_combustible(id INT AUTO_INCREMENT PRIMARY KEY,anio INT NOT NULL,mes INT NOT NULL,fecha_inicio DATE NOT NULL,fecha_fin DATE NOT NULL,fecha_cierre DATETIME NOT NULL,estado VARCHAR(20) NOT NULL,total_registros INT DEFAULT 0,total_galones DECIMAL(12,2) DEFAULT 0,actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY reporte_mes_unico (anio,mes))`
  );

  // --- TABLA alertas_combustible: consumos sospechosos ----------------------
  // Se generan solas al guardar un registro (ver record.service.js):
  // por superar la capacidad del tanque o por desviarse del promedio histórico.
  await db.query(
    `CREATE TABLE IF NOT EXISTS alertas_combustible(id INT AUTO_INCREMENT PRIMARY KEY,registro_id INT NULL,fecha DATE NOT NULL,maquina VARCHAR(80) NOT NULL,operario VARCHAR(120),cantidad DECIMAL(12,2) NOT NULL,capacidad_galones DECIMAL(12,2) NOT NULL,exceso_galones DECIMAL(12,2) NOT NULL,observaciones TEXT,justificacion TEXT,estado VARCHAR(30) DEFAULT 'pendiente',justificado_por VARCHAR(80),justificado_en DATETIME,reporte_nombre VARCHAR(255),reporte_ruta VARCHAR(500),reporte_tipo VARCHAR(100),creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  );
  await agregarColumnaSiFalta('alertas_combustible', 'registro_id', 'INT NULL');
  // tipo_alerta distingue 'sobrecapacidad' de 'promedio'.
  await agregarColumnaSiFalta(
    'alertas_combustible',
    'tipo_alerta',
    "VARCHAR(30) NOT NULL DEFAULT 'sobrecapacidad'"
  );
  await agregarColumnaSiFalta('alertas_combustible', 'promedio_galones', 'DECIMAL(12,2) NULL');
  await agregarColumnaSiFalta(
    'alertas_combustible',
    'porcentaje_sobre_promedio',
    'DECIMAL(8,2) NULL'
  );
  // Quién y cuándo justificó la alerta.
  await agregarColumnaSiFalta('alertas_combustible', 'justificado_por', 'VARCHAR(80) NULL');
  await agregarColumnaSiFalta('alertas_combustible', 'justificado_en', 'DATETIME NULL');
  // Archivo de soporte adjunto a la justificación (se guarda en /uploads).
  await agregarColumnaSiFalta('alertas_combustible', 'reporte_nombre', 'VARCHAR(255) NULL');
  await agregarColumnaSiFalta('alertas_combustible', 'reporte_ruta', 'VARCHAR(500) NULL');
  await agregarColumnaSiFalta('alertas_combustible', 'reporte_tipo', 'VARCHAR(100) NULL');
  await agregarColumnaSiFalta('alertas_combustible', 'detalle_alerta', 'VARCHAR(255) NULL');
  await agregarColumnaSiFalta('alertas_combustible', 'valor_referencia', 'DECIMAL(12,2) NULL');

  // Migración del índice único: antes solo se permitía UNA alerta por registro;
  // ahora se permite una por registro Y tipo, para que un mismo registro pueda
  // disparar sobrecapacidad y promedio a la vez.
  try {
    await db.query(`ALTER TABLE alertas_combustible DROP INDEX alerta_registro_unico`);
  } catch (error) {
    if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw error; // Ya se había borrado antes
  }
  try {
    await db.query(
      `ALTER TABLE alertas_combustible ADD UNIQUE KEY alerta_registro_tipo_unico (registro_id,tipo_alerta)`
    );
  } catch (error) {
    // Los tres códigos significan "el índice ya existe": no es un problema.
    if (!['ER_DUP_KEYNAME', 'ER_DUP_INDEX', 'ER_MULTIPLE_PRI_KEY'].includes(error.code))
      throw error;
  }

  // --- TABLA notificaciones_combustible: avisos en la campanita ------------
  // Una notificación por alerta y por rol destinatario (clave única).
  await db.query(
    `CREATE TABLE IF NOT EXISTS notificaciones_combustible(id INT AUTO_INCREMENT PRIMARY KEY,alerta_id INT NOT NULL,rol VARCHAR(40) NOT NULL,titulo VARCHAR(180) NOT NULL,mensaje TEXT NOT NULL,leida TINYINT(1) DEFAULT 0,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,leida_en DATETIME NULL,UNIQUE KEY notificacion_unica (alerta_id,rol))`
  );

  // --- TABLA sesiones_combustible: sesiones activas -------------------------
  // Guarda el hash del token (nunca el token), cuándo vence y desde dónde se usó.
  await db.query(
    `CREATE TABLE IF NOT EXISTS sesiones_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,token_hash CHAR(64) NOT NULL UNIQUE,usuario_id INT NOT NULL,expira_en DATETIME NOT NULL,ultimo_uso DATETIME NULL,ip VARCHAR(100),agente VARCHAR(255),creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE,INDEX idx_sesiones_expira(expira_en))`
  );

  // --- TABLA auditoria_combustible: bitácora de acciones --------------------
  // ON DELETE SET NULL: si se borra el usuario, la línea de auditoría se
  // conserva (queda el nombre en texto) pero sin la referencia.
  await db.query(
    `CREATE TABLE IF NOT EXISTS auditoria_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,usuario_id INT NULL,usuario VARCHAR(80),rol VARCHAR(40),accion VARCHAR(40) NOT NULL,modulo VARCHAR(60) NOT NULL,registro_id BIGINT NULL,detalle JSON NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX idx_auditoria_fecha(creado_en),INDEX idx_auditoria_modulo(modulo),FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE SET NULL)`
  );

  // --- TABLA soportes_combustible: archivos adjuntos de las alertas ---------
  // Provisional hasta migrar a Cloudflare R2 (ver shared/infrastructure/storage.js).
  await db.query(
    `CREATE TABLE IF NOT EXISTS soportes_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(255) NOT NULL,tipo VARCHAR(100) NOT NULL,contenido LONGBLOB NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  );

  // --- TABLA intentos_login_combustible: contador anti fuerza bruta ---------
  await db.query(
    `CREATE TABLE IF NOT EXISTS intentos_login_combustible(clave VARCHAR(250) PRIMARY KEY,intentos INT NOT NULL,primer_intento DATETIME NOT NULL)`
  );

  await sincronizarMaquinariaInicial(db); // Carga inicial del catálogo de máquinas

  // Todo listo: se guarda la versión para no repetir este trabajo en el próximo arranque.
  await db.query(
    `INSERT INTO configuracion_combustible(clave,valor) VALUES('schema_version',?) ON DUPLICATE KEY UPDATE valor=VALUES(valor)`,
    [VERSION_ESQUEMA]
  );
}

// Carga por única vez el listado de maquinaria desde data/maquinaria.json.
// Se ejecuta una sola vez gracias a la marca guardada en configuracion_combustible;
// para volver a importar hay que borrar esa fila ('maquinaria_excel_2026_08').
async function sincronizarMaquinariaInicial(db) {
  const [estado] = await db.query(
    `SELECT valor FROM configuracion_combustible WHERE clave='maquinaria_excel_2026_08' LIMIT 1`
  );
  if (estado.length) return; // Ya se importó antes: no se vuelve a tocar la tabla tractores

  const archivo = path.join(__dirname, '../../../data/maquinaria.json');
  if (!fs.existsSync(archivo)) return; // Sin archivo fuente no hay nada que importar
  const maquinaria = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (!Array.isArray(maquinaria) || !maquinaria.length) return; // Archivo vacío o mal formado

  // Todo dentro de una transacción: o se importa completo o no se importa nada.
  // Se usa UNA conexión dedicada: con el pool, cada query podría caer en una
  // conexión distinta y START TRANSACTION/COMMIT no tendrían efecto real.
  const conexion = await db.getConnection();
  try {
    await conexion.beginTransaction();
    await conexion.query('DELETE FROM tractores'); // Reemplazo total del catálogo
    for (const equipo of maquinaria) {
      await conexion.query(
        'INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?)',
        [
          equipo.item,
          equipo.maquina,
          equipo.descripcion,
          equipo.centro_costo,
          equipo.capacidad_galones
        ]
      );
    }
    // Deja la marca para que esta importación no se repita en el próximo arranque.
    await conexion.query(
      `INSERT INTO configuracion_combustible(clave,valor) VALUES('maquinaria_excel_2026_08',?)`,
      [String(maquinaria.length)]
    );
    await conexion.commit();
    console.log(`Maquinaria inicial sincronizada: ${maquinaria.length} equipos.`);
  } catch (error) {
    await conexion.rollback(); // Deshace la importación parcial ante cualquier fallo
    throw error;
  } finally {
    conexion.release(); // Devuelve la conexión al pool
  }
}

module.exports = { prepararTablas };
