// ============================================================================
// schema.js — ESQUEMA DE AIRTABLE (tablas y campos)
// ----------------------------------------------------------------------------
// Es el equivalente de supabase/schema.sql pero para Airtable: la fuente única
// de verdad de qué tablas y columnas existen. La usa scripts/airtable-migrar.js
// para crearlas solas dentro de una base vacía (API de metadatos de Airtable).
// Los nombres de tabla y de columna son LOS MISMOS que en Postgres a propósito:
// así es fácil comparar los dos esquemas y migrar datos entre uno y otro.
// SI AGREGAS UNA COLUMNA NUEVA: agrégala aquí (para que se cree sola) y en el
// repositorio de Airtable correspondiente (src/.../infrastructure/airtable-*).
// ============================================================================

// Atajos para no repetir la forma que pide la API de metadatos de Airtable.
const texto = (name) => ({ name, type: 'singleLineText' });
const textoLargo = (name) => ({ name, type: 'multilineText' });
const numero = (name) => ({ name, type: 'number', options: { precision: 2 } });
const entero = (name) => ({ name, type: 'number', options: { precision: 0 } });
const marca = (name) => ({
  name,
  type: 'checkbox',
  options: { icon: 'check', color: 'greenBright' }
});
const fecha = (name) => ({ name, type: 'date', options: { dateFormat: { name: 'iso' } } });
const fechaHora = (name) => ({
  name,
  type: 'dateTime',
  options: {
    dateFormat: { name: 'iso' },
    timeFormat: { name: '24hour' },
    timeZone: 'utc' // Se guarda en UTC; la app convierte a la hora local al mostrar (ver fechas.js)
  }
});

// Las cuatro columnas de "anulación lógica" que repiten tractores, operarios y
// registros (nunca se borra una fila: se marca como ANULADO con motivo).
const anulacion = () => [
  texto('estado'),
  texto('motivo_anulacion'),
  texto('usuario_anulacion'),
  fechaHora('fecha_anulacion')
];

const TABLAS = {
  usuarios_combustible: [
    texto('usuario'),
    texto('contrasena'),
    texto('rol'),
    marca('debe_cambiar_contrasena'),
    fechaHora('creado_en')
  ],

  // usuario_id guarda el id de Airtable (texto) del usuario dueño del permiso;
  // no es un "Link to record" de Airtable a propósito, para no depender de esa
  // función y poder filtrar con una fórmula simple (más liviano y predecible).
  permisos_usuarios_combustible: [texto('usuario_id'), texto('vista'), fechaHora('creado_en')],

  tractores: [
    entero('item'),
    texto('maquina'),
    texto('descripcion'),
    texto('centro_costo'),
    numero('capacidad_galones'),
    ...anulacion()
  ],

  operarios: [texto('nombre'), texto('cedula'), fechaHora('creado_en'), ...anulacion()],

  // Una fila por día. La unicidad de "fecha" y el "solo se cierra una vez" los
  // vigila el código (AirtableJornadaRepository), porque Airtable no tiene
  // restricciones únicas ni transacciones reales.
  jornadas_combustible: [
    fecha('fecha'),
    numero('m1_inicial'),
    numero('m1_final'),
    numero('m2_inicial'),
    numero('m2_final'),
    numero('galones_m1'),
    numero('galones_m2'),
    numero('total_galones'),
    texto('fuga_biodiesel'),
    texto('sistema_electrico'),
    texto('parada_emergencia'),
    texto('estado'), // 'abierta' | 'cerrada'
    texto('abierta_por'),
    fechaHora('abierta_en'),
    texto('actualizada_por'),
    fechaHora('actualizada_en'),
    texto('cerrada_por'),
    fechaHora('cerrada_en')
  ],

  registros_combustible: [
    fecha('fecha'),
    texto('operario'),
    texto('cedula'),
    texto('maquina'),
    texto('horometro'),
    numero('cantidad'),
    texto('numero_sai'),
    textoLargo('firma'),
    textoLargo('observaciones'),
    texto('registrado_por'),
    fechaHora('registrado_en'),
    ...anulacion()
  ],

  // registro_id / jornada_id guardan el id de Airtable de la fila relacionada
  // (igual que usuario_id en permisos): un solo tipo de dato, sin "Link" de Airtable.
  alertas_combustible: [
    texto('registro_id'),
    texto('jornada_id'),
    fecha('fecha'),
    texto('maquina'),
    texto('operario'),
    numero('cantidad'),
    numero('capacidad_galones'),
    numero('exceso_galones'),
    textoLargo('observaciones'),
    textoLargo('justificacion'),
    texto('estado'),
    texto('justificado_por'),
    fechaHora('justificado_en'),
    texto('reporte_nombre'),
    texto('reporte_ruta'),
    texto('reporte_tipo'),
    texto('tipo_alerta'),
    numero('promedio_galones'),
    numero('porcentaje_sobre_promedio'),
    texto('detalle_alerta'),
    numero('valor_referencia'),
    fechaHora('creado_en')
  ],

  notificaciones_combustible: [
    texto('alerta_id'),
    texto('rol'),
    texto('titulo'),
    textoLargo('mensaje'),
    marca('leida'),
    fechaHora('creado_en'),
    fechaHora('leida_en')
  ],

  // El token NUNCA se guarda en claro, solo su SHA-256 (igual que en Postgres).
  sesiones_combustible: [
    texto('token_hash'),
    texto('usuario_id'),
    fechaHora('expira_en'),
    fechaHora('ultimo_uso'),
    texto('ip'),
    texto('agente'),
    fechaHora('creado_en')
  ],

  // "clave" hace las veces de llave primaria (se busca por ella, no por el id de Airtable).
  intentos_login_combustible: [texto('clave'), entero('intentos'), fechaHora('primer_intento')],

  // Bitácora. A diferencia de Postgres, Airtable NO tiene un mecanismo para
  // impedir editar/borrar filas a nivel de base de datos (ver docs/GUIA-AIRTABLE.md,
  // sección "Auditoría"): la inmutabilidad aquí depende de que nadie use su
  // token de Airtable para tocar esta tabla a mano.
  auditoria_combustible: [
    texto('usuario_id'),
    texto('usuario'),
    texto('rol'),
    texto('accion'),
    texto('modulo'),
    texto('registro_id'),
    textoLargo('detalle'),
    fechaHora('creado_en')
  ],

  suscripciones_push: [
    texto('usuario_id'),
    textoLargo('endpoint'),
    texto('p256dh'),
    texto('auth'),
    texto('agente'),
    fechaHora('creado_en')
  ],

  // Adjuntos de las alertas (PDF/imagen), solo si se usa Airtable en vez de
  // Supabase Storage (ver src/shared/infrastructure/storage.js).
  soportes_combustible: [
    texto('nombre'),
    texto('tipo'),
    { name: 'archivo', type: 'multipleAttachments' },
    fechaHora('creado_en')
  ]
};

module.exports = { TABLAS };
