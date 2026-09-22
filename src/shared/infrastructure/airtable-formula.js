// ============================================================================
// airtable-formula.js — AYUDA PARA ARMAR fórmulas DE AIRTABLE SIN ROMPERSE
// ----------------------------------------------------------------------------
// Airtable no tiene consultas parametrizadas como SQL: los filtros se escriben
// como texto de fórmula (filterByFormula). Esta función escapa comillas y
// barras para que un valor con comilla (p. ej. un nombre "O'Higgins") no rompa
// la fórmula ni permita que alguien inyecte condiciones adicionales.
// ============================================================================

// Envuelve un valor de texto en comillas simples, escapado para Airtable.
function textoFormula(valor) {
  return `'${String(valor ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")}'`;
}

// Combina condiciones con AND()/OR(), ignorando las vacías/nulas.
function combinarFormula(operador, condiciones) {
  const validas = condiciones.filter(Boolean);
  if (!validas.length) return '';
  if (validas.length === 1) return validas[0];
  return `${operador}(${validas.join(',')})`;
}

module.exports = { textoFormula, combinarFormula };
