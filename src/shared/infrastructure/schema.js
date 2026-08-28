const fs = require('fs');
const path = require('path');
const { hashPassword, esHashSeguro } = require('./security');

async function prepararTablas(db) {
  const add = async (tabla, columna, definicion) => {
    try {
      await db.query(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e;
    }
  };

  await db.query(`CREATE TABLE IF NOT EXISTS usuarios_combustible(id INT AUTO_INCREMENT PRIMARY KEY,usuario VARCHAR(80) NOT NULL UNIQUE,contrasena VARCHAR(120) NOT NULL,rol VARCHAR(40) NOT NULL,debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await add('usuarios_combustible','debe_cambiar_contrasena','TINYINT(1) NOT NULL DEFAULT 0');
  await db.query(`ALTER TABLE usuarios_combustible MODIFY COLUMN contrasena VARCHAR(255) NOT NULL`);
  const [usuariosExistentes] = await db.query('SELECT id,contrasena FROM usuarios_combustible');
  for (const usuario of usuariosExistentes) {
    if (!esHashSeguro(usuario.contrasena)) {
      await db.query('UPDATE usuarios_combustible SET contrasena=? WHERE id=?', [hashPassword(usuario.contrasena), usuario.id]);
    }
  }
  await db.query(`CREATE TABLE IF NOT EXISTS registros_combustible(id INT AUTO_INCREMENT PRIMARY KEY,fecha DATE,m1_inicial DECIMAL(12,2),m1_final DECIMAL(12,2),m2_inicial DECIMAL(12,2),m2_final DECIMAL(12,2),galones_m1 DECIMAL(12,2),galones_m2 DECIMAL(12,2),total_galones DECIMAL(12,2),fuga_biodiesel VARCHAR(20),sistema_electrico VARCHAR(30),parada_emergencia VARCHAR(30),cierre_dia TINYINT(1) DEFAULT 0,operario VARCHAR(120),cedula VARCHAR(30),maquina VARCHAR(80),horometro VARCHAR(120),cantidad DECIMAL(12,2),numero_sai VARCHAR(80),firma LONGTEXT,observaciones TEXT,registrado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS permisos_usuarios_combustible(id INT AUTO_INCREMENT PRIMARY KEY,usuario_id INT NOT NULL,vista VARCHAR(40) NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY permiso_unico (usuario_id,vista),FOREIGN KEY (usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE)`);
  await db.query(`CREATE TABLE IF NOT EXISTS tractores(id INT AUTO_INCREMENT PRIMARY KEY,item INT NOT NULL,maquina VARCHAR(20) NOT NULL,descripcion VARCHAR(150) NOT NULL,centro_costo VARCHAR(20) NOT NULL,capacidad_galones DECIMAL(12,2) DEFAULT 0)`);
  await add('tractores','capacidad_galones','DECIMAL(12,2) DEFAULT 0');
  await db.query(`CREATE TABLE IF NOT EXISTS operarios(id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(120) NOT NULL,cedula VARCHAR(30) NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS reportes_combustible(id INT AUTO_INCREMENT PRIMARY KEY,anio INT NOT NULL,mes INT NOT NULL,fecha_inicio DATE NOT NULL,fecha_fin DATE NOT NULL,fecha_cierre DATETIME NOT NULL,estado VARCHAR(20) NOT NULL,total_registros INT DEFAULT 0,total_galones DECIMAL(12,2) DEFAULT 0,actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY reporte_mes_unico (anio,mes))`);

  await db.query(`CREATE TABLE IF NOT EXISTS alertas_combustible(id INT AUTO_INCREMENT PRIMARY KEY,registro_id INT NULL,fecha DATE NOT NULL,maquina VARCHAR(80) NOT NULL,operario VARCHAR(120),cantidad DECIMAL(12,2) NOT NULL,capacidad_galones DECIMAL(12,2) NOT NULL,exceso_galones DECIMAL(12,2) NOT NULL,observaciones TEXT,justificacion TEXT,estado VARCHAR(30) DEFAULT 'pendiente',justificado_por VARCHAR(80),justificado_en DATETIME,reporte_nombre VARCHAR(255),reporte_ruta VARCHAR(500),reporte_tipo VARCHAR(100),creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await add('alertas_combustible','registro_id','INT NULL');
  await add('alertas_combustible','tipo_alerta',"VARCHAR(30) NOT NULL DEFAULT 'sobrecapacidad'");
  await add('alertas_combustible','promedio_galones','DECIMAL(12,2) NULL');
  await add('alertas_combustible','porcentaje_sobre_promedio','DECIMAL(8,2) NULL');
  await add('alertas_combustible','justificado_por','VARCHAR(80) NULL');
  await add('alertas_combustible','justificado_en','DATETIME NULL');
  await add('alertas_combustible','reporte_nombre','VARCHAR(255) NULL');
  await add('alertas_combustible','reporte_ruta','VARCHAR(500) NULL');
  await add('alertas_combustible','reporte_tipo','VARCHAR(100) NULL');
  try { await db.query(`ALTER TABLE alertas_combustible DROP INDEX alerta_registro_unico`); } catch (e) { if (e.code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw e; }
  try { await db.query(`ALTER TABLE alertas_combustible ADD UNIQUE KEY alerta_registro_tipo_unico (registro_id,tipo_alerta)`); } catch (e) { if (!['ER_DUP_KEYNAME','ER_DUP_INDEX','ER_MULTIPLE_PRI_KEY'].includes(e.code)) throw e; }

  await db.query(`CREATE TABLE IF NOT EXISTS notificaciones_combustible(id INT AUTO_INCREMENT PRIMARY KEY,alerta_id INT NOT NULL,rol VARCHAR(40) NOT NULL,titulo VARCHAR(180) NOT NULL,mensaje TEXT NOT NULL,leida TINYINT(1) DEFAULT 0,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,leida_en DATETIME NULL,UNIQUE KEY notificacion_unica (alerta_id,rol))`);
  await db.query(`CREATE TABLE IF NOT EXISTS sesiones_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,token_hash CHAR(64) NOT NULL UNIQUE,usuario_id INT NOT NULL,expira_en DATETIME NOT NULL,ultimo_uso DATETIME NULL,ip VARCHAR(100),agente VARCHAR(255),creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE,INDEX idx_sesiones_expira(expira_en))`);
  await db.query(`CREATE TABLE IF NOT EXISTS auditoria_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,usuario_id INT NULL,usuario VARCHAR(80),rol VARCHAR(40),accion VARCHAR(40) NOT NULL,modulo VARCHAR(60) NOT NULL,registro_id BIGINT NULL,detalle JSON NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX idx_auditoria_fecha(creado_en),INDEX idx_auditoria_modulo(modulo),FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE SET NULL)`);

  await sincronizarMaquinariaInicial(db);
  fs.mkdirSync(path.join(__dirname, '../../../uploads/reportes_alertas'), { recursive: true });
}

async function sincronizarMaquinariaInicial(db) {
  const [marcadores] = await db.query(`SELECT COUNT(*) AS total FROM usuarios_combustible`);
  // La sincronización se controla mediante una tabla de configuración mínima.
  await db.query(`CREATE TABLE IF NOT EXISTS configuracion_combustible(clave VARCHAR(100) PRIMARY KEY,valor VARCHAR(255) NOT NULL)`);
  const [estado] = await db.query(`SELECT valor FROM configuracion_combustible WHERE clave='maquinaria_excel_2026_08' LIMIT 1`);
  if (estado.length) return;

  const archivo = path.join(__dirname, '../../../data/maquinaria.json');
  if (!fs.existsSync(archivo)) return;
  const maquinaria = JSON.parse(fs.readFileSync(archivo,'utf8'));
  if (!Array.isArray(maquinaria) || !maquinaria.length) return;

  await db.query('START TRANSACTION');
  try {
    await db.query('DELETE FROM tractores');
    for (const m of maquinaria) {
      await db.query('INSERT INTO tractores(item,maquina,descripcion,centro_costo,capacidad_galones) VALUES(?,?,?,?,?)',[m.item,m.maquina,m.descripcion,m.centro_costo,m.capacidad_galones]);
    }
    await db.query(`INSERT INTO configuracion_combustible(clave,valor) VALUES('maquinaria_excel_2026_08',?)`,[String(maquinaria.length)]);
    await db.query('COMMIT');
    console.log(`Maquinaria inicial sincronizada: ${maquinaria.length} equipos.`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

module.exports = { prepararTablas };
