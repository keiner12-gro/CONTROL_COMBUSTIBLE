// ============================================================================
// mysql.js — CONEXIÓN A LA BASE DE DATOS
// ----------------------------------------------------------------------------
// Crea el "pool" (grupo de conexiones reutilizables) que usan todos los
// repositorios. Los datos de conexión salen del archivo .env, así que para
// cambiar de servidor de base de datos NO se toca este archivo: se editan las
// variables DB_HOST, DB_USER, DB_PASSWORD, DB_NAME y DB_PORT en .env.
// ============================================================================

const mysql = require('mysql2/promise'); // Driver MySQL con soporte de promesas (async/await)
require('dotenv').config(); // Carga el .env por si este módulo se usa suelto

function crearConexionMySQL() {
  // Detecta si la base está en un servidor remoto (nube) o en la máquina local.
  // De esto dependen el puerto por defecto y si se exige SSL.
  const isRemote = process.env.DB_HOST && !['localhost', '127.0.0.1'].includes(process.env.DB_HOST);

  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1', // Servidor de la base de datos
    user: process.env.DB_USER || 'root', // Usuario de MySQL
    password: process.env.DB_PASSWORD || '', // Contraseña de MySQL
    database: process.env.DB_NAME || 'control_combustible', // Nombre de la base
    port: Number(process.env.DB_PORT) || (isRemote ? 4000 : 3306), // 4000 = TiDB Cloud, 3306 = MySQL local
    waitForConnections: true, // Si no hay conexiones libres, espera en vez de fallar
    connectionLimit: 10, // Máximo de conexiones simultáneas del pool
    queueLimit: 0, // Cola de espera sin límite
    // Conexión cifrada obligatoria cuando la base es remota (o si se fuerza con DB_SSL=true)
    ssl:
      isRemote || process.env.DB_SSL === 'true'
        ? {
            minVersion: 'TLSv1.2', // No acepta versiones viejas e inseguras de TLS
            rejectUnauthorized: true // Valida el certificado del servidor (evita man-in-the-middle)
          }
        : undefined // En local no se usa SSL
  });
}

module.exports = { crearConexionMySQL };
