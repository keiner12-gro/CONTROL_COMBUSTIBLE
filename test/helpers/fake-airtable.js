// ============================================================================
// fake-airtable.js — SERVIDOR DE AIRTABLE FALSO PARA PRUEBAS (helper de test)
// ----------------------------------------------------------------------------
// Simula la API REST de Airtable en memoria: guarda filas por tabla, entiende
// listar/crear/actualizar/borrar/subir-adjunto con la MISMA forma que la real
// (lotes de 10, paginación de 100, /meta/bases para el provisionamiento), y
// además EVALÚA de verdad las fórmulas de filterByFormula que arma la app
// (AND/OR/LOWER/UPPER/FIND/DATETIME_FORMAT/SET_TIMEZONE/IS_AFTER/IS_BEFORE/
// RECORD_ID/NOW). No es un intérprete completo de fórmulas de Airtable: solo
// entiende el subconjunto que usa esta app (ver los repositorios airtable-*).
// Se usa como "fetchImpl" al crear el cliente real (crearClienteAirtable), así
// las pruebas ejercitan el código de verdad, no una versión simplificada.
// ============================================================================

const crypto = require('crypto');

// ---------------------------------------------------------------- fórmulas
function tokenizar(formula) {
  const tokens = [];
  let i = 0;
  while (i < formula.length) {
    const c = formula[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '{') {
      const fin = formula.indexOf('}', i);
      tokens.push({ t: 'FIELD', v: formula.slice(i + 1, fin) });
      i = fin + 1;
    } else if (c === "'") {
      let j = i + 1,
        valor = '';
      while (formula[j] !== "'" || formula[j - 1] === '\\') {
        valor += formula[j] === '\\' && formula[j + 1] === "'" ? '' : formula[j];
        j++;
      }
      tokens.push({ t: 'STRING', v: valor });
      i = j + 1;
    } else if (/[0-9]/.test(c)) {
      let j = i;
      while (/[0-9.]/.test(formula[j])) j++;
      tokens.push({ t: 'NUMBER', v: Number(formula.slice(i, j)) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (/[A-Za-z_]/.test(formula[j])) j++;
      tokens.push({ t: 'IDENT', v: formula.slice(i, j) });
      i = j;
    } else if ('()'.includes(c)) {
      tokens.push({ t: c });
      i++;
    } else if (c === ',') {
      tokens.push({ t: ',' });
      i++;
    } else if ('=!<>'.includes(c)) {
      let op = c;
      if (formula[i + 1] === '=') op += '=';
      tokens.push({ t: 'OP', v: op });
      i += op.length;
    } else {
      throw new Error(`Símbolo de fórmula no reconocido: "${c}" en ${formula}`);
    }
  }
  return tokens;
}

function analizar(tokens) {
  let pos = 0;
  const mirar = () => tokens[pos];
  const tomar = () => tokens[pos++];

  function termino() {
    const tok = tomar();
    if (tok.t === 'FIELD') return { tipo: 'campo', nombre: tok.v };
    if (tok.t === 'STRING') return { tipo: 'literal', valor: tok.v };
    if (tok.t === 'NUMBER') return { tipo: 'literal', valor: tok.v };
    if (tok.t === 'IDENT') {
      tomar(); // '('
      const args = [];
      if (mirar().t !== ')') {
        args.push(expresion());
        while (mirar().t === ',') {
          tomar();
          args.push(expresion());
        }
      }
      tomar(); // ')'
      return { tipo: 'llamada', nombre: tok.v, args };
    }
    throw new Error('Token inesperado en la fórmula: ' + JSON.stringify(tok));
  }

  function expresion() {
    const izq = termino();
    if (mirar() && mirar().t === 'OP') {
      const op = tomar().v;
      const der = termino();
      return { tipo: 'comparacion', op, izq, der };
    }
    return izq;
  }

  const nodo = expresion();
  if (pos !== tokens.length) throw new Error('Sobró texto al final de la fórmula.');
  return nodo;
}

function truthy(v) {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return Boolean(v);
}

function evaluar(nodo, fila, contexto) {
  switch (nodo.tipo) {
    case 'campo':
      return fila[nodo.nombre] ?? '';
    case 'literal':
      return nodo.valor;
    case 'comparacion': {
      const l = evaluar(nodo.izq, fila, contexto);
      const r = evaluar(nodo.der, fila, contexto);
      const numerico = typeof l === 'number' && typeof r === 'number';
      const a = numerico ? l : String(l);
      const b = numerico ? r : String(r);
      switch (nodo.op) {
        case '=':
          return a === b;
        case '!=':
          return a !== b;
        case '>=':
          return a >= b;
        case '<=':
          return a <= b;
        case '>':
          return a > b;
        case '<':
          return a < b;
        default:
          throw new Error('Operador no soportado: ' + nodo.op);
      }
    }
    case 'llamada': {
      const args = nodo.args;
      const ev = (i) => evaluar(args[i], fila, contexto);
      switch (nodo.nombre) {
        case 'AND':
          return args.every((a) => truthy(evaluar(a, fila, contexto)));
        case 'OR':
          return args.some((a) => truthy(evaluar(a, fila, contexto)));
        case 'LOWER':
          return String(ev(0)).toLowerCase();
        case 'UPPER':
          return String(ev(0)).toUpperCase();
        case 'FIND':
          return String(ev(1)).indexOf(String(ev(0))) + 1; // 0 = no encontrado, igual que Airtable
        case 'RECORD_ID':
          return contexto.idActual;
        case 'NOW':
          return contexto.ahora.toISOString();
        case 'SET_TIMEZONE': {
          const iso = ev(0);
          const zona = ev(1);
          if (!iso) return '';
          const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: zona,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          return fmt.format(new Date(iso)); // "YYYY-MM-DD" en esa zona
        }
        case 'DATETIME_FORMAT': {
          const valor = ev(0);
          // SET_TIMEZONE ya deja el valor como "YYYY-MM-DD"; un campo Date/DateTime
          // normal trae directamente el texto ISO (con o sin hora): basta recortar.
          return String(valor).slice(0, 10);
        }
        case 'IS_AFTER':
          return new Date(ev(0)).getTime() > new Date(ev(1)).getTime();
        case 'IS_BEFORE':
          return new Date(ev(0)).getTime() < new Date(ev(1)).getTime();
        default:
          throw new Error('Función de fórmula no soportada en el falso Airtable: ' + nodo.nombre);
      }
    }
    default:
      throw new Error('Nodo de fórmula desconocido.');
  }
}

function cumpleFormula(formula, fila, contexto) {
  if (!formula) return true;
  return truthy(evaluar(analizar(tokenizar(formula)), fila, contexto));
}

// ---------------------------------------------------------------- servidor falso
function crearAirtableFalso({ ahora = () => new Date() } = {}) {
  const baseId = 'appFALSO000000000';
  const tablas = new Map(); // nombre -> Map(id -> fila)
  const peticiones = []; // Historial (para comprobar límites de lote en las pruebas)

  function tabla(nombre) {
    if (!tablas.has(nombre)) tablas.set(nombre, new Map());
    return tablas.get(nombre);
  }
  function nuevoId() {
    return 'rec' + crypto.randomBytes(9).toString('hex');
  }
  const registro = (id, fields) => ({ id, createdTime: new Date().toISOString(), fields });

  const adjuntosPorUrl = new Map(); // url pública falsa -> Buffer (simula el hosting de Airtable)

  async function fetch(url, opciones = {}) {
    peticiones.push({ url, metodo: opciones.method || 'GET' });
    const u = new URL(url);
    const metodo = opciones.method || 'GET';
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;

    // --- Descarga de un adjunto ya subido (URL "pública" que Airtable entrega) ---
    if (u.hostname === 'fake-airtable-attachments.test') {
      const buffer = adjuntosPorUrl.get(url);
      if (!buffer) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      };
    }

    // --- API de metadatos (provisionamiento de tablas) ---
    if (u.pathname.startsWith(`/v0/meta/bases/${baseId}/tables`)) {
      return respuestaMeta(u, metodo, cuerpo);
    }

    const partes = u.pathname.replace(/^\/v0\//, '').split('/');

    // Caso especial: subir adjunto es "{baseId}/{recordId}/{campo}/uploadAttachment",
    // SIN nombre de tabla en la URL (Airtable resuelve el registro por su id solo).
    if (metodo === 'POST' && partes[3] === 'uploadAttachment') {
      const recordId = decodeURIComponent(partes[1]);
      const campo = decodeURIComponent(partes[2]);
      const nombreTabla = [...tablas.keys()].find((n) => tabla(n).has(recordId));
      return respuestaSubirAdjunto(nombreTabla, recordId, campo, cuerpo);
    }

    const nombreTabla = decodeURIComponent(partes[1]);
    const idOAccion = partes[2] ? decodeURIComponent(partes[2]) : null;

    if (metodo === 'GET' && !idOAccion) return respuestaListar(u, nombreTabla);
    if (metodo === 'GET' && idOAccion) return respuestaObtener(nombreTabla, idOAccion);
    if (metodo === 'POST') return respuestaCrear(nombreTabla, cuerpo);
    if (metodo === 'PATCH') return respuestaActualizar(nombreTabla, cuerpo);
    if (metodo === 'DELETE') return respuestaEliminar(nombreTabla, u);

    return json(404, { error: { message: 'Ruta no reconocida en el Airtable falso: ' + url } });
  }

  function respuestaListar(u, nombreTabla) {
    const formula = u.searchParams.get('filterByFormula');
    const contexto = { ahora: ahora(), idActual: null };
    let filas = [...tabla(nombreTabla).entries()]
      .filter(([id, f]) => cumpleFormula(formula, f, { ...contexto, idActual: id }))
      .map(([id, f]) => registro(id, f));

    // Orden (sort[0][field]/sort[0][direction], puede haber varios)
    const orden = [];
    let i = 0;
    while (u.searchParams.has(`sort[${i}][field]`)) {
      orden.push({
        campo: u.searchParams.get(`sort[${i}][field]`),
        dir: u.searchParams.get(`sort[${i}][direction]`) || 'asc'
      });
      i++;
    }
    if (orden.length)
      filas.sort((a, b) => {
        for (const { campo, dir } of orden) {
          const x = a.fields[campo] ?? '';
          const y = b.fields[campo] ?? '';
          if (x < y) return dir === 'asc' ? -1 : 1;
          if (x > y) return dir === 'asc' ? 1 : -1;
        }
        return 0;
      });

    const pageSize = Number(u.searchParams.get('pageSize') || 100);
    const offset = Number(u.searchParams.get('offset') || 0);
    const pagina = filas.slice(offset, offset + pageSize);
    const hayMas = offset + pageSize < filas.length;
    return json(200, { records: pagina, offset: hayMas ? String(offset + pageSize) : undefined });
  }

  function respuestaObtener(nombreTabla, id) {
    const fila = tabla(nombreTabla).get(id);
    if (!fila)
      return json(404, { error: { type: 'NOT_FOUND', message: 'Registro no encontrado' } });
    return json(200, registro(id, fila));
  }

  function respuestaCrear(nombreTabla, cuerpo) {
    if (cuerpo.records.length > 10)
      return json(422, { error: { message: 'Máximo 10 registros por llamada.' } });
    const t = tabla(nombreTabla);
    const creados = cuerpo.records.map((r) => {
      const id = nuevoId();
      t.set(id, { ...r.fields });
      return registro(id, t.get(id));
    });
    return json(200, { records: creados });
  }

  function respuestaActualizar(nombreTabla, cuerpo) {
    if (cuerpo.records.length > 10)
      return json(422, { error: { message: 'Máximo 10 registros por llamada.' } });
    const t = tabla(nombreTabla);
    const actualizados = [];
    for (const r of cuerpo.records) {
      if (!t.has(r.id))
        return json(404, { error: { type: 'NOT_FOUND', message: `No existe ${r.id}` } });
      t.set(r.id, { ...t.get(r.id), ...r.fields });
      actualizados.push(registro(r.id, t.get(r.id)));
    }
    return json(200, { records: actualizados });
  }

  function respuestaEliminar(nombreTabla, u) {
    const ids = u.searchParams.getAll('records[]');
    if (ids.length > 10)
      return json(422, { error: { message: 'Máximo 10 registros por llamada.' } });
    const t = tabla(nombreTabla);
    ids.forEach((id) => t.delete(id));
    return json(200, { records: ids.map((id) => ({ id, deleted: true })) });
  }

  function respuestaSubirAdjunto(nombreTabla, id, campo, cuerpo) {
    const t = tabla(nombreTabla);
    if (!t.has(id)) return json(404, { error: { message: 'Fila no encontrada' } });
    const url = `https://fake-airtable-attachments.test/${nuevoId()}/${encodeURIComponent(cuerpo.filename)}`;
    const contenido = Buffer.from(cuerpo.file, 'base64');
    adjuntosPorUrl.set(url, contenido);
    const adjunto = {
      id: nuevoId(),
      url,
      filename: cuerpo.filename,
      type: cuerpo.contentType,
      size: contenido.length
    };
    t.set(id, { ...t.get(id), [campo]: [adjunto] });
    return json(200, { id, fields: t.get(id) });
  }

  // nombre de tabla -> lista de campos {name,...} (para simular la API de metadatos)
  const metaTablasCreadas = new Map();

  function respuestaMeta(u, metodo, cuerpo) {
    if (metodo === 'GET') {
      return json(200, {
        tables: [...metaTablasCreadas.entries()].map(([nombre, campos]) => ({
          id: 'tbl_' + nombre,
          name: nombre,
          fields: campos
        }))
      });
    }
    if (metodo === 'POST' && u.pathname.endsWith('/tables')) {
      tabla(cuerpo.name); // La crea vacía
      metaTablasCreadas.set(cuerpo.name, cuerpo.fields);
      return json(200, { id: 'tbl_' + cuerpo.name, name: cuerpo.name, fields: cuerpo.fields });
    }
    if (metodo === 'POST' && u.pathname.endsWith('/fields')) {
      // .../meta/bases/{baseId}/tables/{tableId}/fields
      const tableId = decodeURIComponent(u.pathname.split('/').slice(-2, -1)[0]);
      const nombreTabla = tableId.replace(/^tbl_/, '');
      const campos = metaTablasCreadas.get(nombreTabla) || [];
      campos.push(cuerpo);
      metaTablasCreadas.set(nombreTabla, campos);
      return json(200, cuerpo);
    }
    return json(404, { error: { message: 'Meta no soportada en el falso Airtable' } });
  }

  function json(status, cuerpo) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => cuerpo,
      text: async () => JSON.stringify(cuerpo)
    };
  }

  return {
    baseId,
    fetch,
    peticiones,
    // Atajos para preparar datos directamente en las pruebas, sin pasar por HTTP.
    sembrar(nombreTabla, filas) {
      const t = tabla(nombreTabla);
      const ids = [];
      for (const f of filas) {
        const id = nuevoId();
        t.set(id, f);
        ids.push(id);
      }
      return ids;
    },
    leerTabla(nombreTabla) {
      return [...tabla(nombreTabla).entries()].map(([id, f]) => ({ id, ...f }));
    }
  };
}

module.exports = { crearAirtableFalso, evaluar, analizar, tokenizar };
