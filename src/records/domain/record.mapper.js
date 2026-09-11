// ============================================================================
// record.mapper.js (DOMINIO) — TRADUCTOR BASE DE DATOS <-> FRONTEND
// ----------------------------------------------------------------------------
// En MySQL las columnas usan guion_bajo (m1_inicial) y en el JavaScript del
// navegador se usa camelCase (m1Inicial). Esta función hace esa conversión.
// SI AGREGAS UNA COLUMNA NUEVA a registros_combustible y quieres que llegue al
// frontend, DEBES AÑADIRLA AQUÍ; si no, nunca aparecerá en las pantallas.
// ============================================================================

function convertirRegistroParaFrontend(registro) {
  return {
    id: String(registro.id), // Se envía como texto para no perder precisión en JS
    // La fecha se recorta a formato YYYY-MM-DD (sin hora ni zona horaria).
    fecha: registro.fecha ? new Date(registro.fecha).toISOString().slice(0, 10) : '',
    m1Inicial: registro.m1_inicial, // Lectura inicial del medidor 1
    m1Final: registro.m1_final, // Lectura final del medidor 1
    m2Inicial: registro.m2_inicial, // Lectura inicial del medidor 2
    m2Final: registro.m2_final, // Lectura final del medidor 2
    galonesM1: registro.galones_m1, // Galones calculados del medidor 1
    galonesM2: registro.galones_m2, // Galones calculados del medidor 2
    totalGalones: registro.total_galones, // Suma de ambos medidores
    fugaBiodiesel: registro.fuga_biodiesel, // Checklist diario: ¿hay fuga?
    sistemaElectrico: registro.sistema_electrico, // Checklist diario: estado eléctrico
    paradaEmergencia: registro.parada_emergencia, // Checklist diario: parada de emergencia
    // ¿Esta fila es el cierre del día? Se toma la bandera cierre_dia, pero si
    // viene nula (registros antiguos anteriores a esa columna) se deduce: tiene
    // las cuatro lecturas de medidores y no tiene operario ni máquina.
    cierreDia:
      Number(registro.cierre_dia) === 1 ||
      (registro.cierre_dia == null &&
        registro.m1_inicial != null &&
        registro.m1_final != null &&
        registro.m2_inicial != null &&
        registro.m2_final != null &&
        !String(registro.operario || '').trim() &&
        !String(registro.maquina || '').trim()),
    operario: registro.operario, // Nombre de quien cargó
    cedula: registro.cedula, // Documento del operario
    maquina: registro.maquina, // Código de la máquina abastecida
    horometro: registro.horometro, // Lectura del horómetro de la máquina
    cantidad: registro.cantidad, // Galones cargados en esta operación
    numeroSai: registro.numero_sai, // Número de vale/documento SAI
    firma: registro.firma, // Firma del operario (imagen en base64)
    observaciones: registro.observaciones, // Texto libre
    registradoEn: registro.registrado_en // Marca de tiempo de creación
  };
}

module.exports = { convertirRegistroParaFrontend };
