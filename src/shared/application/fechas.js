// ============================================================================
// fechas.js — FECHAS Y HORAS EN LA ZONA HORARIA DE LA OPERACIÓN
// ----------------------------------------------------------------------------
// Vercel corre en hora UTC. Colombia es UTC-5, así que después de las 7 p. m.
// "hoy" en UTC ya es mañana en la finca. Todo el sistema pregunta la fecha
// "de hoy" AQUÍ, nunca con new Date().toISOString().
// Para cambiar de zona: variable ZONA_HORARIA en .env (por defecto America/Bogota).
// ============================================================================

function zona() {
  return process.env.ZONA_HORARIA || 'America/Bogota';
}

// Partes (año, mes, día, hora, minuto) de un instante, vistas en la zona local.
function partesLocales(instante = new Date()) {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const partes = {};
  for (const p of formato.formatToParts(instante)) partes[p.type] = p.value;
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute)
  };
}

// Fecha de hoy en la zona local: "YYYY-MM-DD".
function hoyLocal(instante = new Date()) {
  const p = partesLocales(instante);
  return `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

// Hora local expresada en minutos desde medianoche (para comparar con la hora de corte).
function minutosLocales(instante = new Date()) {
  const p = partesLocales(instante);
  return p.hora * 60 + p.minuto;
}

// Suma (o resta) días a una fecha "YYYY-MM-DD" sin depender de la zona horaria.
function sumarDias(fecha, dias) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return f.toISOString().slice(0, 10);
}

// ¿Es una fecha real con formato YYYY-MM-DD?
function esFechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) return false;
  const [a, m, d] = String(fecha).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

// Hora de corte (minutos desde medianoche) a partir de la que se considera
// "tarde" para cerrar la jornada. Variable HORA_LIMITE_CIERRE=18:00.
function horaLimiteCierreMinutos() {
  const [h, m] = String(process.env.HORA_LIMITE_CIERRE || '18:00')
    .split(':')
    .map(Number);
  return (Number.isFinite(h) ? h : 18) * 60 + (Number.isFinite(m) ? m : 0);
}

module.exports = {
  zona,
  partesLocales,
  hoyLocal,
  minutosLocales,
  sumarDias,
  esFechaValida,
  horaLimiteCierreMinutos
};
