// ============================================================================
// jornada.mapper.js (DOMINIO) — TRADUCTOR BASE DE DATOS <-> FRONTEND
// ----------------------------------------------------------------------------
// En la base las columnas usan guion_bajo (m1_inicial); en el navegador se usa
// camelCase (m1Inicial). SI AGREGAS UNA COLUMNA a jornadas_combustible y quieres
// que llegue a las pantallas, añádela AQUÍ.
// ============================================================================

function convertirJornadaParaFrontend(j) {
  if (!j) return null;
  return {
    id: String(j.id),
    fecha: String(j.fecha).slice(0, 10),
    estado: j.estado, // 'abierta' (borrador) | 'cerrada'
    m1Inicial: j.m1_inicial,
    m1Final: j.m1_final,
    m2Inicial: j.m2_inicial,
    m2Final: j.m2_final,
    galonesM1: j.galones_m1,
    galonesM2: j.galones_m2,
    totalGalones: j.total_galones,
    fugaBiodiesel: j.fuga_biodiesel,
    sistemaElectrico: j.sistema_electrico,
    paradaEmergencia: j.parada_emergencia,
    abiertaPor: j.abierta_por,
    abiertaEn: j.abierta_en,
    actualizadaPor: j.actualizada_por,
    actualizadaEn: j.actualizada_en,
    cerradaPor: j.cerrada_por,
    cerradaEn: j.cerrada_en,
    // Compatibilidad con el reporte: una jornada se pinta como "cierre del día".
    cierreDia: true
  };
}

module.exports = { convertirJornadaParaFrontend };
