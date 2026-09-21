// ============================================================================
// retroactivo.js — ¿QUIÉN PUEDE REGISTRAR CON UNA FECHA QUE NO ES HOY?
// ----------------------------------------------------------------------------
//   super_administrador -> sin límite
//   administrador       -> hasta DIAS_ATRAS_ADMIN días atrás (30 por defecto)
//   supervisor          -> hasta DIAS_ATRAS_PERMITIDOS días atrás (3 por defecto)
//   operario y demás    -> solo hoy
// Se usa al guardar suministros y al guardar/cerrar la jornada.
// ============================================================================

const { hoyLocal, sumarDias } = require('./fechas');

function limiteDiasAtras(rol) {
  if (rol === 'administrador') return Number(process.env.DIAS_ATRAS_ADMIN || 30);
  if (rol === 'supervisor') return Number(process.env.DIAS_ATRAS_PERMITIDOS || 3);
  return 0; // Operario u otro rol: 0 días hacia atrás
}

// Devuelve null si se puede, o el mensaje de por qué no.
//   fecha: "YYYY-MM-DD".
//   jornadaAbierta: true si esa fecha ya tiene una jornada abierta (pendiente de
//   cerrar): completar algo que ya se empezó siempre se permite.
function motivoDeRechazoPorFecha(usuario, fecha, { jornadaAbierta = false } = {}) {
  const hoy = hoyLocal();
  if (!fecha || fecha === hoy) return null;
  if (usuario.rol === 'super_administrador') return null;
  if (jornadaAbierta) return null;
  const limite = limiteDiasAtras(usuario.rol);
  if (limite <= 0)
    return usuario.rol === 'operario'
      ? 'Solo puedes registrar con la fecha de hoy.'
      : 'No tienes permiso para registrar con una fecha anterior.';
  if (fecha < sumarDias(hoy, -limite))
    return `No puedes registrar una fecha con más de ${limite} día(s) de antigüedad.`;
  return null;
}

module.exports = { limiteDiasAtras, motivoDeRechazoPorFecha };
