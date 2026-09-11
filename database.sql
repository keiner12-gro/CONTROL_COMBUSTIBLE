-- ============================================================================
-- database.sql — SCRIPT DE CREACIÓN DE LA BASE DE DATOS
-- ----------------------------------------------------------------------------
-- Sirve para crear la base desde cero a mano (por ejemplo en un servidor nuevo
-- o en phpMyAdmin/Workbench).
-- IMPORTANTE: en el día a día NO hace falta ejecutarlo. El servidor crea y
-- actualiza estas mismas tablas solo al arrancar, mediante
-- src/shared/infrastructure/schema.js, que además agrega las columnas nuevas.
-- Si modificas una tabla aquí, hazlo TAMBIÉN en schema.js o el cambio se
-- perderá en el próximo arranque.
-- ============================================================================

-- Crea la base solo si no existe y se posiciona en ella.
CREATE DATABASE IF NOT EXISTS control_combustible;
USE control_combustible;

-- USUARIOS: cuentas de acceso. La contraseña se guarda como hash scrypt
-- (nunca en texto plano) y "debe_cambiar_contrasena" obliga al cambio inicial.
CREATE TABLE IF NOT EXISTS usuarios_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario VARCHAR(80) NOT NULL UNIQUE,
  contrasena VARCHAR(255) NOT NULL,
  rol VARCHAR(40) NOT NULL,
  debe_cambiar_contrasena TINYINT(1) NOT NULL DEFAULT 0,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- REGISTROS: tabla central del sistema. Guarda tanto los suministros como los
-- cierres de día (esos llevan cierre_dia=1 y no tienen operario ni máquina).
-- Nota: aquí faltan las columnas de anulación (estado, motivo_anulacion,
-- usuario_anulacion, fecha_anulacion); schema.js las agrega automáticamente.
CREATE TABLE IF NOT EXISTS registros_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY, fecha DATE, m1_inicial DECIMAL(12,2), m1_final DECIMAL(12,2), m2_inicial DECIMAL(12,2), m2_final DECIMAL(12,2),
  galones_m1 DECIMAL(12,2), galones_m2 DECIMAL(12,2), total_galones DECIMAL(12,2), fuga_biodiesel VARCHAR(20), sistema_electrico VARCHAR(30), parada_emergencia VARCHAR(30),
  cierre_dia TINYINT(1) DEFAULT 0, operario VARCHAR(120), cedula VARCHAR(30), maquina VARCHAR(80), horometro VARCHAR(120), cantidad DECIMAL(12,2), numero_sai VARCHAR(80), firma LONGTEXT, observaciones TEXT,
  registrado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PERMISOS: qué vista puede usar cada usuario (una fila por permiso).
-- ON DELETE CASCADE = al borrar el usuario, sus permisos se borran solos.
CREATE TABLE IF NOT EXISTS permisos_usuarios_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, vista VARCHAR(40) NOT NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY permiso_unico (usuario_id,vista), FOREIGN KEY (usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE
);

-- TRACTORES: catálogo de maquinaria. capacidad_galones es la base de las
-- alertas de sobrecapacidad.
CREATE TABLE IF NOT EXISTS tractores (
  id INT AUTO_INCREMENT PRIMARY KEY, item INT NOT NULL, maquina VARCHAR(20) NOT NULL, descripcion VARCHAR(150) NOT NULL, centro_costo VARCHAR(20) NOT NULL, capacidad_galones DECIMAL(12,2) DEFAULT 0
);

-- OPERARIOS: personas autorizadas para cargar combustible.
CREATE TABLE IF NOT EXISTS operarios (id INT AUTO_INCREMENT PRIMARY KEY,nombre VARCHAR(120) NOT NULL,cedula VARCHAR(30) NOT NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

-- REPORTES: un resumen por mes. La clave única (anio,mes) impide duplicados y
-- permite que el servidor actualice el mes en lugar de crear otro.
CREATE TABLE IF NOT EXISTS reportes_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY,anio INT NOT NULL,mes INT NOT NULL,fecha_inicio DATE NOT NULL,fecha_fin DATE NOT NULL,fecha_cierre DATETIME NOT NULL,estado VARCHAR(20) NOT NULL,total_registros INT DEFAULT 0,total_galones DECIMAL(12,2) DEFAULT 0,actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,UNIQUE KEY reporte_mes_unico (anio,mes)
);

-- ALERTAS: consumos sospechosos detectados automáticamente. La clave única
-- (registro_id,tipo_alerta) permite varias alertas por registro, pero solo una
-- de cada tipo.
CREATE TABLE IF NOT EXISTS alertas_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY,registro_id INT NULL,fecha DATE NOT NULL,maquina VARCHAR(80) NOT NULL,operario VARCHAR(120),cantidad DECIMAL(12,2) NOT NULL,capacidad_galones DECIMAL(12,2) NOT NULL,exceso_galones DECIMAL(12,2) NOT NULL,observaciones TEXT,justificacion TEXT,estado VARCHAR(30) DEFAULT 'pendiente',justificado_por VARCHAR(80),justificado_en DATETIME,reporte_nombre VARCHAR(255),reporte_ruta VARCHAR(500),reporte_tipo VARCHAR(100),tipo_alerta VARCHAR(30) NOT NULL DEFAULT 'sobrecapacidad',promedio_galones DECIMAL(12,2) NULL,porcentaje_sobre_promedio DECIMAL(8,2) NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY alerta_registro_tipo_unico(registro_id,tipo_alerta)
);

-- NOTIFICACIONES: el aviso de cada alerta para cada rol (la campanita).
CREATE TABLE IF NOT EXISTS notificaciones_combustible (
  id INT AUTO_INCREMENT PRIMARY KEY,alerta_id INT NOT NULL,rol VARCHAR(40) NOT NULL,titulo VARCHAR(180) NOT NULL,mensaje TEXT NOT NULL,leida TINYINT(1) DEFAULT 0,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,leida_en DATETIME NULL,UNIQUE KEY notificacion_unica(alerta_id,rol)
);

-- CONFIGURACIÓN: tabla clave/valor. Hoy se usa para marcar que la maquinaria
-- inicial (data/maquinaria.json) ya fue importada y no repetir la carga.
CREATE TABLE IF NOT EXISTS configuracion_combustible(clave VARCHAR(100) PRIMARY KEY,valor VARCHAR(255) NOT NULL);

-- SESIONES: sesiones activas. Se guarda el SHA-256 del token, nunca el token,
-- para que leer esta tabla no permita suplantar a nadie.
CREATE TABLE IF NOT EXISTS sesiones_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,token_hash CHAR(64) NOT NULL UNIQUE,usuario_id INT NOT NULL,expira_en DATETIME NOT NULL,ultimo_uso DATETIME NULL,ip VARCHAR(100),agente VARCHAR(255),creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE CASCADE,INDEX idx_sesiones_expira(expira_en));

-- AUDITORÍA: bitácora de quién hizo qué. ON DELETE SET NULL conserva el
-- historial aunque se elimine la cuenta del usuario.
CREATE TABLE IF NOT EXISTS auditoria_combustible(id BIGINT AUTO_INCREMENT PRIMARY KEY,usuario_id INT NULL,usuario VARCHAR(80),rol VARCHAR(40),accion VARCHAR(40) NOT NULL,modulo VARCHAR(60) NOT NULL,registro_id BIGINT NULL,detalle JSON NULL,creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,INDEX idx_auditoria_fecha(creado_en),INDEX idx_auditoria_modulo(modulo),FOREIGN KEY(usuario_id) REFERENCES usuarios_combustible(id) ON DELETE SET NULL);
