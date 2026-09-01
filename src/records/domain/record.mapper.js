function convertirRegistroParaFrontend(registro) {
  return {
    id: String(registro.id),
    fecha: registro.fecha ? new Date(registro.fecha).toISOString().slice(0, 10) : '',
    m1Inicial: registro.m1_inicial,
    m1Final: registro.m1_final,
    m2Inicial: registro.m2_inicial,
    m2Final: registro.m2_final,
    galonesM1: registro.galones_m1,
    galonesM2: registro.galones_m2,
    totalGalones: registro.total_galones,
    fugaBiodiesel: registro.fuga_biodiesel,
    sistemaElectrico: registro.sistema_electrico,
    paradaEmergencia: registro.parada_emergencia,
    cierreDia:
      Number(registro.cierre_dia) === 1 ||
      (registro.cierre_dia == null &&
        registro.m1_inicial != null &&
        registro.m1_final != null &&
        registro.m2_inicial != null &&
        registro.m2_final != null &&
        !String(registro.operario || '').trim() &&
        !String(registro.maquina || '').trim()),
    operario: registro.operario,
    cedula: registro.cedula,
    maquina: registro.maquina,
    horometro: registro.horometro,
    cantidad: registro.cantidad,
    numeroSai: registro.numero_sai,
    firma: registro.firma,
    observaciones: registro.observaciones,
    registradoEn: registro.registrado_en
  };
}

module.exports = { convertirRegistroParaFrontend };
