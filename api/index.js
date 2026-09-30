// ============================================================================
// api/index.js — PUNTO DE ENTRADA EN VERCEL (Serverless Function)
// ----------------------------------------------------------------------------
// Vercel no ejecuta "node server.js": convierte este archivo en una función sin
// servidor y le entrega cada petición que NO sea un archivo estático de public/
// (ver los "rewrites" de vercel.json). Aquí no hay lógica: solo se reexporta la
// app de Express que arma server.js, de modo que en local (npm start) y en
// producción corre exactamente el mismo código.
//
// NO agregues rutas en este archivo: van en server.js / src/<módulo>/.
// ============================================================================

module.exports = require('../server.js');
