const mysql = require('mysql2/promise');
require('dotenv').config();

function crearConexionMySQL() {
  return mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'control_combustible',
    port: Number(process.env.DB_PORT) || 4000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: process.env.DB_SSL === 'true' ? {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    } : undefined
  });
}

module.exports = { crearConexionMySQL };
