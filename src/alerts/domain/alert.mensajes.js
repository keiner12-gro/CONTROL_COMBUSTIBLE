// ============================================================================
// alert.mensajes.js (DOMINIO) — TEXTOS DE LAS NOTIFICACIONES DE ALERTA
// ----------------------------------------------------------------------------
// Un solo lugar para el título y el mensaje de cada tipo de alerta, para que
// el repositorio de Postgres y el de Airtable digan exactamente lo mismo.
// PARA CAMBIAR LOS TEXTOS DE LAS ALERTAS -> aquí.
// PARA CAMBIAR QUIÉN RECIBE LOS AVISOS -> el arreglo de roles en cada
// repositorio (pg-alert.repository.js / airtable-alert.repository.js).
// ============================================================================

const TITULOS_ALERTA = {
  sobrecapacidad: 'Alerta de sobrecapacidad',
  promedio: 'Alerta de consumo superior al promedio',
  horometro_irregular: 'Alerta de horómetro irregular',
  inspeccion_pendiente: 'Alerta de inspección pendiente',
  cierre_pendiente: 'Alerta de cierre pendiente'
};

// Redacta el mensaje explicativo según el tipo de alerta.
function construirMensaje(alerta) {
  switch (alerta.tipoAlerta) {
    case 'promedio':
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones, un ${Number(alerta.porcentajeSobrePromedio).toFixed(1)}% por encima de su promedio histórico de ${Number(alerta.promedioGalones).toFixed(2)} galones.`;
    case 'horometro_irregular':
      return `La máquina ${alerta.maquina} registró una lectura de horómetro irregular: "${alerta.detalle || 'sin valor numérico'}"${alerta.valorReferencia ? `. El último horómetro válido registrado fue ${Number(alerta.valorReferencia).toFixed(2)}.` : '.'}`;
    case 'inspeccion_pendiente':
      return `El cierre del día ${alerta.fecha} se guardó sin diligenciar el checklist de inspección diaria (fuga de biodiésel, sistema eléctrico y parada de emergencia).`;
    case 'cierre_pendiente':
      return `La jornada del ${alerta.fecha} sigue abierta: falta ingresar las lecturas finales de M1/M2 y guardar el cierre del día.`;
    default:
      return `La máquina ${alerta.maquina} registró ${Number(alerta.cantidad).toFixed(2)} galones y supera su capacidad de ${Number(alerta.capacidadGalones).toFixed(2)} galones.`;
  }
}

module.exports = { TITULOS_ALERTA, construirMensaje };
