# Guía: Airtable (montaje y traspaso a la cuenta de la empresa)

La app puede usar **Airtable** en vez de Postgres/Supabase como base de datos. Es un interruptor, no una versión
distinta del código: la misma app, el mismo frontend, las mismas reglas de negocio; solo cambia dónde se guardan
los datos. Se activa con **una variable de entorno** (`DB_PROVIDER=airtable`) y dos claves de Airtable.

```
Navegador / app instalada ──► Vercel (Express) ──► Airtable  (AIRTABLE_API_KEY + AIRTABLE_BASE_ID)
                                                     (datos Y archivos adjuntos, todo en la misma base)
Vercel Cron (2 veces al día) ──► /api/tareas/recordatorio-cierre ──► alertas + notificaciones push
```

---

## 1. Crear la base en Airtable

1. Entra a <https://airtable.com> con la cuenta/organización de la empresa.
2. **Create → Start from scratch** → nómbrala `Control de Combustible`. Debe quedar **vacía** (bórrale la tabla
   de ejemplo "Table 1" si Airtable la crea sola).
3. Copia el **Base ID** de la URL: `airtable.com/appXXXXXXXXXXXXXX/...` → la parte que empieza por `app` es
   `AIRTABLE_BASE_ID`.
4. Ve a <https://airtable.com/create/tokens> → **Create new token**:
   - Nombre: `control-combustible-servidor`.
   - **Scopes**: `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`.
   - **Access**: agrega esta base concreta (no "all bases", para no dar más acceso del necesario).
   - Crea el token y cópialo → es `AIRTABLE_API_KEY`. Solo se muestra una vez.

> ⚠️ Ese token da acceso total a los datos de la base. Va solo en variables de entorno (`.env` local y Vercel),
> nunca en git, chats ni el navegador. Si se filtra, revócalo en la misma página y crea uno nuevo.

## 2. Crear las tablas y los datos iniciales

```bash
npm install
cp .env.example .env
```

En tu `.env`, deja las líneas de Postgres tal como están (no hace falta borrarlas) y agrega:

```
DB_PROVIDER=airtable
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
```

Luego:

```bash
npm run airtable:migrar     # crea las 13 tablas y sus columnas (idempotente)
ADMIN_USUARIO=admin ADMIN_CONTRASENA="una-clave-temporal-larga" npm run airtable:sembrar
```

`airtable:migrar` usa la *Metadata API* de Airtable para crear las tablas solas, con sus columnas — no hay que
crear nada a mano en la interfaz. Se puede correr varias veces sin duplicar nada; si agregas una columna nueva en
`airtable/schema.js`, correrlo de nuevo la agrega a la tabla que ya existe.

## 3. Probar en local

```bash
npm start          # con DB_PROVIDER=airtable en tu .env, usa Airtable de verdad
npm test            # pruebas automáticas (con un Airtable SIMULADO: no toca tu base real ni gasta cupo de API)
```

## 4. Publicar en Vercel

1. **Settings → Environment Variables**: agrega `DB_PROVIDER=airtable`, `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`,
   más las que ya usa cualquier instalación (`CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT`, `ZONA_HORARIA`, `HORA_LIMITE_CIERRE`). Las de Supabase (`DATABASE_URL`, `SUPABASE_*`) se
   pueden dejar o quitar: con `DB_PROVIDER=airtable` la app no las usa.
2. **Deploy** (o Redeploy si el proyecto ya existía).
3. Prueba el cron igual que con Supabase:
   ```bash
   curl -H "Authorization: Bearer TU_CRON_SECRET" https://TU-DOMINIO/api/tareas/recordatorio-cierre
   ```

## 5. Cómo pasarlo a la cuenta de la empresa

Igual de simple que con Supabase (ver `docs/GUIA-SUPABASE.md` sección 6): crea la base y el token en la
organización de Airtable de la empresa, corre `airtable:migrar` + `airtable:sembrar` contra ella, y carga esas
variables nuevas en el Vercel de la empresa. **No hay que tocar código.**

---

## 6. Qué es distinto de Postgres (para que no sorprenda)

Airtable no es una base de datos relacional con SQL: no tiene transacciones reales, ni restricciones "único", ni
`JOIN`, ni agregaciones (`SUM`/`GROUP BY`). La app lo compensa así, y conviene que quien la mantenga lo sepa:

| Tema | Cómo se resuelve en Airtable |
|---|---|
| **Un solo cierre por día** | Se revisa "¿ya existe?" antes de cerrar. Con dos personas cerrando el MISMO día al MISMO segundo, en teoría podrían chocar. Como el registro y el cierre los hace una sola persona a la vez, el riesgo real es prácticamente nulo. |
| **Transacciones** (guardar un suministro + su alerta + su jornada) | El cliente de Airtable (`src/shared/infrastructure/airtable-client.js`) implementa una "transacción de compensación": si algo falla a mitad de camino, deshace lo que alcanzó a crear/editar. No es 100% atómico como Postgres, pero cubre el uso real de la app. |
| **Auditoría inmutable** | En Postgres lo impide la propia base de datos (un trigger), pase lo que pase. En Airtable esa garantía **no existe a nivel de base**: la API de la app no ofrece editar ni borrar eventos, pero alguien con el token de Airtable sí podría alterar la tabla a mano en la interfaz. |
| **Búsquedas y reportes** | Se calculan trayendo las filas y sumando/agrupando en el servidor (en vez de que lo haga la base). Con el tamaño de datos de una operación como esta, no se nota; si la bitácora creciera mucho, convendría revisarlo. |
| **Límite de velocidad** | Airtable permite ~5 peticiones por segundo por base. El cliente ya espacía las peticiones solo y reintenta si lo alcanza a superar. El autoguardado de las lecturas M1/M2 es lo que más peticiones genera; si en el futuro varias personas escriben a la vez muy seguido, ese sería el primer lugar a revisar. |
| **Archivos adjuntos** | Van en una tabla `soportes_combustible` con un campo de adjuntos de Airtable (no hace falta Supabase Storage ni ningún otro servicio). |

## 7. Ver el modelo de datos

En Airtable: abre la base → menú **⋯** de cualquier tabla, o el ícono de diagrama en **Database** (en el panel
lateral) → **Schema Visualizer** muestra las 13 tablas. A diferencia de Postgres, aquí las relaciones entre
tablas (por ejemplo, a qué usuario pertenece un permiso) se guardan como **texto** con el id de Airtable de la
fila relacionada (columnas `usuario_id`, `registro_id`, `jornada_id`, `alerta_id`...), no como "Link to another
record": así el código sabe exactamente qué buscar, sin depender de una configuración manual en la interfaz.

## 8. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `Falta AIRTABLE_API_KEY o AIRTABLE_BASE_ID.` | No están en el `.env` (o en Vercel), o `DB_PROVIDER` no dice `airtable`. |
| `Airtable respondió 401` / `INVALID_AUTHORIZATION` | El token no tiene acceso a esa base, o le faltan alcances. Revísalo en airtable.com/create/tokens. |
| `Airtable respondió 422` al crear/editar | Algún campo no coincide con el tipo de columna esperado. Revisa que `npm run airtable:migrar` haya corrido sin errores. |
| Todo muy lento, o errores 429 esporádicos | Se está chocando con el límite de 5 peticiones/segundo. El cliente reintenta solo; si persiste, es una señal de que el uso creció y conviene revisar el límite en `airtable-client.js` (`ESPERA_MIN_MS`). |
