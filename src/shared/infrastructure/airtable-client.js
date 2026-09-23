// ============================================================================
// airtable-client.js — CLIENTE HTTP DE AIRTABLE (bajo nivel)
// ----------------------------------------------------------------------------
// Envuelve la API REST de Airtable para que el resto de la app no tenga que
// pensar en límites de velocidad, lotes de 10 registros ni paginación.
// Se usa SOLO cuando DB_PROVIDER=airtable (ver src/shared/infrastructure/db.js
// y server.js). Con Postgres/Supabase este archivo no se carga.
//
// Qué resuelve:
//   * Límite de velocidad de Airtable (5 peticiones/segundo por base): se
//     espacian las peticiones y se reintenta con espera si aun así llega un 429.
//   * Los lotes de creación/edición/borrado de Airtable aceptan MÁXIMO 10
//     registros por llamada: aquí se parte solo, sin que el resto del código
//     tenga que acordarse.
//   * La paginación (100 filas por página) se resuelve sola en listar().
//   * "Transacción" de compensación: Airtable NO tiene transacciones reales.
//     transaction(fn) anota todo lo que fn() va creando/editando y, si fn()
//     lanza un error, intenta deshacerlo (borra lo creado, restaura lo editado)
//     antes de relanzar el error. No es 100% atómico (alguien podría alcanzar a
//     leer un dato a medio camino), pero cubre el caso real de esta app: un
//     solo operario registrando de a una carga a la vez.
//   * Columnas de relación como "Link to another record": la app trabaja con
//     el id como texto ("rec..."), pero Airtable entrega/pide los enlaces como
//     lista (["rec..."]). Al primer uso se consulta el esquema de la base y se
//     traduce solo en ambos sentidos. Si la columna es texto, no se toca.
//   * El id de la fila es SIEMPRE el de Airtable ("rec..."), aunque la tabla
//     tenga además una columna llamada "id" (p. ej. los números de Supabase).
// PARA CAMBIAR EL LÍMITE DE VELOCIDAD -> ESPERA_MIN_MS.
// ============================================================================

const { TABLAS } = require('../../../airtable/schema');

const ESPERA_MIN_MS = 230; // ~4.3 peticiones/segundo: un margen prudente bajo el límite de 5/s de Airtable
const TAMANO_LOTE = 10; // Máximo de registros por petición que acepta la API de Airtable
const TAMANO_PAGINA = 100; // Máximo de filas por página en las consultas de listado

function partir(lista, tamano) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

function crearClienteAirtable({ apiKey, baseId, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || !baseId) throw new Error('Falta AIRTABLE_API_KEY o AIRTABLE_BASE_ID.');

  let ultimaPeticion = 0;
  // Espera lo necesario para no superar el límite de velocidad de Airtable.
  async function esperarTurno() {
    const falta = ultimaPeticion + ESPERA_MIN_MS - Date.now();
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    ultimaPeticion = Date.now();
  }

  // Petición HTTP de bajo nivel, con reintento automático si Airtable responde
  // 429 (demasiadas peticiones) o un error 5xx pasajero.
  async function peticion(metodo, ruta, cuerpo, intento = 1) {
    await esperarTurno();
    const respuesta = await fetchImpl(`https://api.airtable.com/v0/${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    if (respuesta.status === 429 || respuesta.status >= 500) {
      if (intento >= 5) throw await errorDeRespuesta(respuesta);
      // Espera creciente (1s, 2s, 4s...) antes de reintentar.
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (intento - 1)));
      return peticion(metodo, ruta, cuerpo, intento + 1);
    }
    if (!respuesta.ok) throw await errorDeRespuesta(respuesta);
    return respuesta.status === 204 ? null : respuesta.json();
  }

  async function errorDeRespuesta(respuesta) {
    const texto = await respuesta.text().catch(() => '');
    let mensaje = `Airtable respondió ${respuesta.status}`;
    try {
      const json = JSON.parse(texto);
      if (json?.error?.message) mensaje = json.error.message;
      else if (json?.error?.type) mensaje = json.error.type;
    } catch (_) {
      if (texto) mensaje += `: ${texto.slice(0, 200)}`;
    }
    return Object.assign(new Error(mensaje), { status: respuesta.status >= 500 ? 502 : 400 });
  }

  const rutaTabla = (tabla) => `${baseId}/${encodeURIComponent(tabla)}`;

  // Columnas de la app (airtable/schema.js) que en la base son "Link to another
  // record": { tabla: Set(columnas) }. Se consulta una sola vez; si falla (token
  // sin schema.bases:read, red...) se asume que no hay enlaces y se reintenta
  // en la próxima petición.
  let enlacesPendientes = null;
  function enlacesDe(tabla) {
    if (!enlacesPendientes)
      enlacesPendientes = peticion('GET', `meta/bases/${baseId}/tables`)
        .then(({ tables = [] }) => {
          const mapa = {};
          for (const t of tables) {
            const deLaApp = new Set((TABLAS[t.name] || []).map((c) => c.name));
            mapa[t.name] = new Set(
              t.fields
                .filter((f) => f.type === 'multipleRecordLinks' && deLaApp.has(f.name))
                .map((f) => f.name)
            );
          }
          return mapa;
        })
        .catch(() => {
          enlacesPendientes = null;
          return {};
        });
    return enlacesPendientes.then((mapa) => mapa[tabla] || new Set());
  }

  return {
    // --- Lectura -------------------------------------------------------------
    // Trae TODAS las filas que cumplen la fórmula, recorriendo las páginas solo.
    async listar(tabla, { formula, orden, maxFilas } = {}) {
      const enlaces = await enlacesDe(tabla);
      const registros = [];
      let offset;
      do {
        const parametros = new URLSearchParams();
        parametros.set('pageSize', String(TAMANO_PAGINA));
        if (formula) parametros.set('filterByFormula', formula);
        if (orden)
          orden.forEach((o, i) => {
            parametros.set(`sort[${i}][field]`, o.campo);
            parametros.set(`sort[${i}][direction]`, o.direccion || 'asc');
          });
        if (offset) parametros.set('offset', offset);
        const pagina = await peticion('GET', `${rutaTabla(tabla)}?${parametros}`);
        registros.push(...pagina.records.map((r) => aFila(r, enlaces)));
        offset = pagina.offset;
        if (maxFilas && registros.length >= maxFilas) return registros.slice(0, maxFilas);
      } while (offset);
      return registros;
    },

    async obtener(tabla, id) {
      if (!id) return null;
      try {
        const enlaces = await enlacesDe(tabla);
        return aFila(await peticion('GET', `${rutaTabla(tabla)}/${id}`), enlaces);
      } catch (error) {
        if (error.status === 404 || error.status === 400) return null; // Id inexistente o mal formado
        throw error;
      }
    },

    // --- Escritura (en lotes de 10 automáticamente) --------------------------
    async crear(tabla, filas) {
      const enlaces = await enlacesDe(tabla);
      const creadas = [];
      for (const lote of partir(filas, TAMANO_LOTE)) {
        const resultado = await peticion('POST', rutaTabla(tabla), {
          typecast: true, // Admite texto para campos numéricos/fecha sin que la app tenga que formatear
          records: lote.map((campos) => ({ fields: limpiar(campos, enlaces) }))
        });
        creadas.push(...resultado.records.map((r) => aFila(r, enlaces)));
      }
      return creadas;
    },

    async actualizar(tabla, cambios) {
      // cambios: [{ id, campos }]
      const enlaces = await enlacesDe(tabla);
      const actualizadas = [];
      for (const lote of partir(cambios, TAMANO_LOTE)) {
        const resultado = await peticion('PATCH', rutaTabla(tabla), {
          typecast: true,
          records: lote.map(({ id, campos }) => ({ id, fields: limpiar(campos, enlaces) }))
        });
        actualizadas.push(...resultado.records.map((r) => aFila(r, enlaces)));
      }
      return actualizadas;
    },

    async eliminar(tabla, ids) {
      for (const lote of partir(ids, TAMANO_LOTE)) {
        const parametros = new URLSearchParams();
        lote.forEach((id) => parametros.append('records[]', id));
        await peticion('DELETE', `${rutaTabla(tabla)}?${parametros}`);
      }
    },

    // Sube un archivo directo a un campo de adjuntos (soportes de alertas), sin
    // necesitar una URL pública primero. contenidoBase64 va SIN el prefijo
    // "data:...;base64,". Requiere el alcance "data.records:write" del token.
    async subirAdjunto(tabla, id, campo, { nombre, tipo, contenidoBase64 }) {
      return peticion('POST', `${baseId}/${id}/${encodeURIComponent(campo)}/uploadAttachment`, {
        contentType: tipo,
        filename: nombre,
        file: contenidoBase64
      });
    },

    // --- "Transacción" de compensación (ver cabecera del archivo) ------------
    async transaction(fn) {
      const deshacer = []; // Pasos para revertir, en orden inverso a como se hicieron
      const cliente = this;
      const contexto = {
        ...cliente,
        // Las creaciones dentro de la transacción se anotan para poder borrarlas.
        async crear(tabla, filas) {
          const creadas = await cliente.crear(tabla, filas);
          deshacer.push(() =>
            cliente
              .eliminar(
                tabla,
                creadas.map((f) => f.id)
              )
              .catch(() => {})
          );
          return creadas;
        },
        // Las ediciones se anotan con su valor ANTERIOR para poder restaurarlo.
        async actualizar(tabla, cambios) {
          const anteriores = await Promise.all(cambios.map((c) => cliente.obtener(tabla, c.id)));
          const actualizadas = await cliente.actualizar(tabla, cambios);
          deshacer.push(() =>
            Promise.all(
              anteriores
                .filter(Boolean)
                .map((fila) =>
                  cliente.actualizar(tabla, [{ id: fila.id, campos: sinId(fila) }]).catch(() => {})
                )
            )
          );
          return actualizadas;
        },
        transaction: undefined // Las transacciones no se anidan
      };
      try {
        return await fn(contexto);
      } catch (error) {
        // Se deshace en orden inverso (lo último que se hizo, lo primero que se revierte).
        for (const paso of deshacer.reverse()) await paso();
        throw error;
      }
    }
  };
}

// Airtable devuelve { id, createdTime, fields:{...} }; la app trabaja con un
// objeto plano { id, ...columnas } (igual que las filas que devuelve Postgres).
// El id va al final para que una columna "id" de la base no lo reemplace, y
// cada enlace ["rec..."] se entrega como "rec..." (igual que si fuera texto).
function aFila(registro, enlaces = new Set()) {
  if (!registro) return null;
  const fila = { ...registro.fields, id: registro.id };
  for (const campo of enlaces)
    if (Array.isArray(fila[campo])) fila[campo] = fila[campo][0] ?? null;
  return fila;
}

function sinId({ id, ...resto }) {
  return resto;
}

// Airtable rechaza "undefined"; un campo que no se quiere tocar simplemente no
// se envía. null SÍ se envía (borra el valor de ese campo). En una columna de
// enlace, "rec..." se envía como ["rec..."] y null/"" como [] (sin enlace).
function limpiar(campos, enlaces = new Set()) {
  const salida = {};
  for (const [clave, valor] of Object.entries(campos)) {
    if (valor === undefined) continue;
    if (enlaces.has(clave) && !Array.isArray(valor)) salida[clave] = valor ? [String(valor)] : [];
    else salida[clave] = valor;
  }
  return salida;
}

module.exports = { crearClienteAirtable };
