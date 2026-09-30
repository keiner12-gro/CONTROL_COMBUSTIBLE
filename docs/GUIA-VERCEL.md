# Guía: publicar esta app en Vercel

Esta guía es **solo el despliegue**. La base de datos se monta aparte, según cuál uses:
`docs/GUIA-SUPABASE.md` (PostgreSQL) o `docs/GUIA-AIRTABLE.md` (Airtable). Haz primero una de las dos:
sin base de datos la app despliega, pero no arranca.

```
Navegador / app instalada
        │
        ├── /css /js /icons /assets /vendor /sw.js ──► CDN de Vercel (archivos de public/, sin servidor)
        │
        └── / /login /menu ... y /api/* ───────────► api/index.js (Express) ──► Supabase o Airtable
                                                              ▲
Vercel Cron (2 veces al día) ──► /api/tareas/recordatorio-cierre
```

## Cómo está armado el despliegue

| Archivo         | Para qué                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `api/index.js`  | Punto de entrada en Vercel. Solo reexporta la app de Express de `server.js` (mismo código que en local).   |
| `vercel.json`   | Manda todo lo que no sea un archivo de `public/` a esa función, fija cabeceras y programa los _cron jobs_. |
| `.vercelignore` | Deja fuera del despliegue lo que no corre en producción (`test/`, `docs/`, ...).                           |
| `package.json`  | `engines.node` fija la versión de Node con la que Vercel construye y ejecuta.                              |

Dos detalles que conviene conocer:

- **Los archivos de `public/` los sirve el CDN**, no el servidor: las pantallas cargan más rápido y cada
  imagen o CSS deja de gastar una invocación de función. Las páginas (`/login`, `/menu`, ...) y todo `/api`
  sí pasan por Express, que es quien pone las cabeceras de seguridad y la cookie de sesión.
- **No hay disco donde escribir.** Los adjuntos de las alertas van a Supabase Storage o a Airtable según
  `DB_PROVIDER` (ver `src/shared/infrastructure/storage.js`). Si faltan esas variables, subir un soporte
  responde _"Almacenamiento de archivos sin configurar"_.

## 1. Importar el proyecto

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → elige este repositorio.
   Si Vercel no lo lista, dale acceso en _Adjust GitHub App Permissions_.
2. **Framework Preset**: `Other`. No toques _Build Command_ ni _Output Directory_: `vercel.json` ya manda.
3. **Root Directory**: la raíz del repositorio (déjalo como está).
4. Antes de dar _Deploy_, carga las variables de entorno del paso 2.

## 2. Variables de entorno

_Settings → Environment Variables_. Márcalas para **Production**, **Preview** y **Development** salvo que
quieras una base distinta en las _preview_. Los nombres son los mismos de `.env.example`.

Con `DB_PROVIDER=postgres` (valor por defecto, no hace falta escribirlo):

| Variable               | Obligatoria | De dónde sale                                                             |
| ---------------------- | ----------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`         | Sí          | Supabase → _Connect_ → **Transaction pooler** (puerto **6543**, no 5432). |
| `SUPABASE_URL`         | Sí          | Supabase → _Project Settings → API_ → _Project URL_.                      |
| `SUPABASE_SERVICE_KEY` | Sí          | La clave `service_role`. **Secreta**: jamás en git ni en el navegador.    |
| `SUPABASE_BUCKET`      | No          | `soportes` si no la pones.                                                |

Con `DB_PROVIDER=airtable`: `AIRTABLE_API_KEY` y `AIRTABLE_BASE_ID` (ver `docs/GUIA-AIRTABLE.md`).

Comunes a las dos opciones:

| Variable                                     | Obligatoria | Notas                                                                                      |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `CRON_SECRET`                                | Sí          | Mínimo 16 caracteres. **Vercel lo envía solo a sus cron jobs**; con otro nombre no sirve.  |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`     | No          | Sin ellas las notificaciones push quedan apagadas. Se generan con `npm run generar-vapid`. |
| `VAPID_SUBJECT`                              | No          | `mailto:` de contacto.                                                                     |
| `ZONA_HORARIA`                               | Sí          | `America/Bogota`. Sin ella las fechas se van a UTC y el cierre del día no cuadra.          |
| `HORA_LIMITE_CIERRE`                         | No          | `18:00` por defecto.                                                                       |
| `DIAS_ATRAS_PERMITIDOS` / `DIAS_ATRAS_ADMIN` | No          | Fechas retroactivas permitidas por rol.                                                    |

`PUERTO` y `DB_DRIVER` son solo para desarrollo local: **no** las cargues en Vercel. `NODE_ENV` la pone
Vercel sola.

## 3. Región

_Settings → Functions → Function Region_: elige la **misma región de tu base de datos** (para Supabase en
São Paulo, `gru1`). Cada consulta cruza la red: con la región equivocada la app se siente lenta aunque
todo esté bien.

## 4. Desplegar y comprobar

_Deploy_, y cuando termine revisa sobre la URL que te dio Vercel:

1. `/` muestra el login (y `/login` también).
2. Entrar con un usuario real: si responde _"Sesión no válida"_ o error 500, mira _Deployments → Logs_;
   casi siempre es `DATABASE_URL` mal copiada o la base sin tablas (`npm run db:migrar` desde tu equipo).
3. Abrir la app desde el celular y comprobar que ofrece **instalarla** (PWA) y que se ve sin internet.
4. El cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://TU-APP.vercel.app/api/tareas/recordatorio-cierre`
   debe responder un JSON. Sin la cabecera debe responder `401` — si responde otra cosa, revisa `CRON_SECRET`.

## 5. Cron jobs

Los dos horarios viven en `vercel.json` (están en **UTC**: `0 12` = 7:00 a. m. y `0 23` = 6:00 p. m. hora
Colombia). Se activan solos al desplegar en **Production**; en _preview_ no corren. En el plan Hobby de
Vercel hay un máximo de dos y con frecuencia diaria: si necesitas más, el mismo endpoint lo puede llamar
`pg_cron` de Supabase o cualquier programador externo, siempre con la cabecera `Authorization: Bearer <CRON_SECRET>`.

Para verlos: _Settings → Cron Jobs_.

## 6. Dominio propio

_Settings → Domains_ y apunta el DNS a Vercel. Es **obligatorio un dominio fijo con HTTPS** si vas a generar
el APK de Android: las URL de _preview_ cambian en cada despliegue y rompen la verificación
(ver `docs/GUIA-APP-MOVIL.md`).

## 7. Si este repositorio es un _fork_

Vercel despliega a producción lo que llegue a la rama principal del **fork**, no a la del repositorio
original. Para traer los cambios nuevos del original:

```bash
git remote add upstream https://github.com/keiner12-gro/CONTROL_COMBUSTIBLE.git   # una sola vez
git fetch upstream
git checkout main
git merge upstream/main
git push origin main        # esto dispara el despliegue en Vercel
```

También sirve el botón **Sync fork** de GitHub. Cada rama que subas genera un despliegue de _preview_ con su
propia URL; usa esas para probar antes de tocar producción.

## Problemas frecuentes

| Síntoma                                                   | Causa                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `404: NOT_FOUND` en todas las páginas                     | El _Root Directory_ del proyecto no es la raíz del repositorio, o falta `api/index.js`.            |
| Error 500 apenas abre, con _"Falta DATABASE_URL"_ en logs | No cargaste las variables, o las pusiste solo en _Preview_ y no en _Production_.                   |
| `FUNCTION_INVOCATION_TIMEOUT`                             | Consulta muy lenta: revisa la región (paso 3) y usa el _Transaction pooler_ (6543).                |
| Se agotan las conexiones de Postgres                      | Usa el pooler de Supabase; si aun así pasa, baja `DB_POOL_MAX` (por defecto 5).                    |
| El cron responde `401`                                    | `CRON_SECRET` distinto en Vercel, o de menos de 16 caracteres (con menos, la tarea queda apagada). |
| La app quedó con una versión vieja en el celular          | El service worker guarda copia: sube `VERSION` en `public/sw.js` y vuelve a desplegar.             |
| Cambios que no aparecen                                   | Vercel despliega a producción solo la rama principal; lo demás queda como _preview_.               |
