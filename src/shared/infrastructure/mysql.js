const mysql = require('mysql2/promise');

function crearConexionMySQL(env = process.env) {
  return mysql.createPool({
    host: env.DB_HOST || 'localhost',
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'control_combustible',
    waitForConnections: true,
    connectionLimit: 10
  });
}

module.exports = { crearConexionMySQL };
