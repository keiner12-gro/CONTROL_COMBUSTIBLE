// ============================================================================
// record.mapper.js (DOMINIO) — TRADUCTOR BASE DE DATOS <-> FRONTEND
// ----------------------------------------------------------------------------
// En la base las columnas usan guion_bajo (numero_sai) y en el JavaScript del
// navegador se usa camelCase (numeroSai). Esta función hace esa conversión.
// SI AGREGAS UNA COLUMNA NUEVA a registros_combustible y quieres que llegue al
// frontend, DEBES AÑADIRLA AQUÍ; si no, nunca aparecerá en las pantallas.
// (Los medidores M1/M2 y el checklist son de la jornada: ver jornada.mapper.js.)
// ============================================================================

function convertirRegistroParaFrontend(registro) {
  return {
    id: String(registro.id), // Se envía como texto para no perder precisión en JS
    fecha: String(registro.fecha).slice(0, 10), // YYYY-MM-DD, sin hora ni zona horaria
    cierreDia: false, // Un suministro nunca es el cierre del día (eso es la jornada)
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
