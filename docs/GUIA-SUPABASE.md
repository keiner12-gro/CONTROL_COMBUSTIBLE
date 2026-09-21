# Guía: Supabase + Vercel (montaje y traspaso a la cuenta de la empresa)

La app usa **Vercel** (servidor y pantallas) y **Supabase** (base de datos PostgreSQL + almacenamiento de
archivos). Todo el esquema está en **un solo archivo** (`supabase/schema.sql`) y la app solo lee **variables de
entorno**, por eso cambiar de cuenta no exige tocar código.

```
Navegador / app instalada ──► Vercel (Express) ──► Supabase Postgres  (DATABASE_URL)
                                    │
                                    └────────────► Supabase Storage   (SUPABASE_URL + SUPABASE_SERVICE_KEY)
Vercel Cron (2 veces al día) ──► /api/tareas/recordatorio-cierre ──► alertas + notificaciones push
```

---

## 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com> y crea la cuenta. Crea una **Organization** con el nombre de la empresa
   (p. ej. "Guaicaramo"): así el proyecto se puede transferir después sin rehacerlo.
2. **New project** → nombre `control-combustible`, contraseña de base de datos **fuerte** (guárdala en un gestor de
   contraseñas) y región cercana a la finca (Colombia → *South America (São Paulo)*).
3. Cuando termine de crearse, copia estos tres datos:

| Variable | Dónde se encuentra |
|---|---|
| `DATABASE_URL` | Botón **Connect** → **Transaction pooler** (puerto **6543**). Reemplaza `[YOUR-PASSWORD]`. |
| `SUPABASE_URL` | **Project Settings → API → Project URL** |
| `SUPABASE_SERVICE_KEY` | **Project Settings → API → service_role** (secreta). |

> ⚠️ La `service_role` da acceso total. Solo va en variables de entorno (`.env` local y Vercel). **Nunca** en git,
> chats ni en el navegador. Si se filtra, se regenera en el mismo panel.

Usa el **Transaction pooler** (6543) para Vercel: abre muchas conexiones cortas. Para scripts locales
(`db:migrar`, `migrar-datos`) también funciona; si falla, prueba con el *Session pooler* (5432).

## 2. Crear las tablas y los datos iniciales

En tu computador, con Node 18+:

```bash
npm install
cp .env.example .env        # y pega DATABASE_URL, SUPABASE_URL y SUPABASE_SERVICE_KEY
npm run db:migrar           # crea las 12 tablas, el bucket "soportes" y la auditoría inmutable
```

Alternativa sin terminal: pega `supabase/schema.sql` completo en **Supabase → SQL Editor → Run**.

Luego los datos iniciales (maquinaria y primer administrador):

```bash
ADMIN_USUARIO=admin ADMIN_CONTRASENA="una-clave-temporal-larga" npm run db:sembrar
```

El administrador deberá cambiar la contraseña en su primer ingreso. En Windows PowerShell:
`$env:ADMIN_USUARIO="admin"; $env:ADMIN_CONTRASENA="..."; npm run db:sembrar`.

## 3. Probar en local

* **Sin Supabase** (Postgres embebido, ideal para desarrollar): `npm run dev:local` → <http://localhost:3000>
  (usuarios de demostración `admin`, `supervisor`, `operario`; contraseña `demo1234`. Solo en local.)
* **Con Supabase**: `npm start` (lee tu `.env`).
* **Pruebas automáticas**: `npm test` (no necesitan internet ni Supabase).

## 4. Publicar en Vercel

1. Importa el repositorio en Vercel (o usa el proyecto existente).
2. **Settings → Environment Variables** (marca Production y Preview) con **todas** las de `.env.example`:
   `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `ZONA_HORARIA`, `HORA_LIMITE_CIERRE`.
   * `CRON_SECRET`: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
   * Claves push: `npm run generar-vapid`.
3. **Settings → Functions → Region**: elige la más cercana a Supabase (São Paulo = `gru1`) para menos latencia.
4. **Deploy**. Los dos *cron jobs* de `vercel.json` (7:00 a. m. y 6:00 p. m. hora Colombia) llaman solos a
   `/api/tareas/recordatorio-cierre` con `Authorization: Bearer $CRON_SECRET`.
   El plan Hobby permite 2 cron jobs de 1 ejecución diaria; con Pro se puede ejecutar con más frecuencia.
5. Prueba el cron a mano (debe responder JSON con `pendientes`, `alertasNuevas`, `push`):
   ```bash
   curl -H "Authorization: Bearer TU_CRON_SECRET" https://TU-DOMINIO/api/tareas/recordatorio-cierre
   ```

## 5. Migrar los datos de la base antigua (MySQL/TiDB → Supabase)

Solo si ya hay datos reales. El proyecto de Supabase debe estar **vacío** (el script se niega a duplicar).

```bash
# En .env: ORIGEN_DB_HOST, ORIGEN_DB_USER, ORIGEN_DB_PASSWORD, ORIGEN_DB_NAME, ORIGEN_DB_PORT (TiDB = 4000)
npm run migrar-datos -- --simular   # muestra el resumen SIN escribir nada
npm run migrar-datos                # migra en una sola transacción y verifica los totales
```

Qué hace: copia usuarios, permisos, máquinas, operarios, suministros, alertas, notificaciones y auditoría con los
mismos números (id); **separa** los cierres M1/M2 (ahora tabla `jornadas`) de los suministros; mueve las alertas de
inspección a su jornada; sube los adjuntos de `uploads/` a Storage; y al final compara conteos y galones. Las
sesiones no se copian (todos vuelven a iniciar sesión).

---

## 6. ➜ Pasar todo a la cuenta de la empresa (guía para el desarrollador)

Hay dos caminos. **A** es el más corto; **B** es el más limpio si se quiere empezar de cero.

### Camino A — Transferir los proyectos (sin rehacer nada)
1. **Supabase**: en el proyecto → *Settings → General → Transfer project* → elegir la organización de la empresa.
   Las claves y `DATABASE_URL` **no cambian**.
2. **Vercel**: *Settings → General → Transfer Project* (o *Add New → Project* con el mismo repositorio en la
   cuenta de la empresa, cargando las mismas variables).
3. Verificar (sección 7) y **regenerar** `SUPABASE_SERVICE_KEY`, la contraseña de la base y `CRON_SECRET`
   (quedaron conocidas por quien montó el proyecto). Actualizarlas en Vercel y redesplegar.

### Camino B — Proyecto nuevo en la cuenta de la empresa
1. Crear el proyecto de Supabase en la cuenta de la empresa (sección 1).
2. `npm run db:migrar` → crea todo el esquema (mismo `schema.sql`).
3. Traer los datos del proyecto actual: se puede volver a usar `migrar-datos` si el origen es la base antigua,
   o exportar/importar con `pg_dump --data-only` / `psql` entre los dos proyectos de Supabase
   (usar la *Session pooler* o la conexión directa).
4. Crear el proyecto en el Vercel de la empresa, cargar las variables **nuevas** y desplegar.
5. Dominio: apuntarlo al nuevo proyecto de Vercel (ver Cloudflare abajo).

### Cambios de código necesarios al pasar de cuenta
**Ninguno.** Solo variables de entorno: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`, `VAPID_*`.
Los tres puntos que sí dependen de la cuenta y no del código: (1) el dominio que usa la app instalada / el APK,
(2) las claves `VAPID` (si se cambian, cada equipo debe volver a activar los avisos) y (3) `assetlinks.json` si
se genera un APK (ver `docs/GUIA-APP-MOVIL.md`).

## 7. Lista de verificación después de un traspaso
- [ ] Entrar con el administrador y cambiar su contraseña.
- [ ] Registrar un suministro de prueba y guardar/cerrar una jornada.
- [ ] Justificar una alerta con un PDF pequeño (prueba Supabase Storage).
- [ ] `curl` al cron responde 200 (no 401) y no da error.
- [ ] Reporte del mes: aparecen suministros, medidores y la conciliación.
- [ ] Auditoría: se ven los eventos; el botón de editar/eliminar no existe.
- [ ] En un celular: instalar la app y activar avisos (ver guía móvil).

## 8. Cloudflare (opcional)
Cloudflare no es necesario para que la app funcione. Aporta, si la empresa ya lo paga:
* **DNS y proxy** del dominio propio → Vercel (Proxy activado, SSL "Full (strict)").
* **WAF / Rate limiting** sobre `/api/login` (refuerza el bloqueo de intentos que ya hace la app).
* **Turnstile** (captcha invisible) en el login, si se quiere.
* **Cron alternativo**: un Worker con *Cron Trigger* que llame al endpoint del cron con el `CRON_SECRET`
  (útil si se necesita más frecuencia que la del plan de Vercel).

## 9. Seguridad y mantenimiento
* Todas las tablas tienen **RLS activado sin políticas**: la API pública de Supabase no puede leer nada; solo la app
  (con `DATABASE_URL`) accede.
* La auditoría es **inmutable a nivel de base de datos** (un trigger impide editar/borrar aunque se use SQL directo).
* Activar **backups** en Supabase (plan Pro: copias diarias) y probar una restauración.
* El plan gratuito de Supabase **pausa** proyectos inactivos 1 semana: para producción usar plan Pro.
* Para agregar columnas/tablas: añadirlas al final de `supabase/schema.sql` con `... IF NOT EXISTS` y ejecutar
  `npm run db:migrar` (es idempotente).

## 10. Problemas frecuentes
| Síntoma | Causa probable |
|---|---|
| `Falta DATABASE_URL` al arrancar | No existe `.env` o falta la variable. |
| `password authentication failed` | Contraseña de la base mal copiada (¿caracteres especiales? codifícala en la URL). |
| `⚠ La base de datos no responde o no tiene las tablas` | Falta `npm run db:migrar`. |
| Adjuntos: "Almacenamiento de archivos sin configurar" | Faltan `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` en Vercel. |
| El cron responde 401 | `CRON_SECRET` distinto entre Vercel y la llamada, o tiene menos de 16 caracteres. |
| Todo muy lento | Región de Vercel lejos de la de Supabase (ver paso 4.3). |
| `self-signed certificate in certificate chain` | El `DATABASE_URL` trae `?sslmode=...`: quítalo (la app ya cifra la conexión), o pon el certificado en `DATABASE_SSL_CA`. |
