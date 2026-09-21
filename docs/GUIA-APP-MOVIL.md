# Guía: app instalable (celular y tablet), notificaciones y APK

La aplicación es una **PWA** (app web instalable): funciona en Android, iPhone/iPad, tablets y Windows sin pasar por
ninguna tienda. Con la misma PWA se puede generar un **APK** para Android.

## 1. Instalar en el equipo

| Equipo | Cómo |
|---|---|
| **Android** (Chrome) | Abrir la dirección de la app → aparece la barra "Instalar" (o menú ⋮ → *Instalar aplicación*). |
| **iPhone / iPad** (Safari) | Botón **Compartir** → **Añadir a pantalla de inicio**. Debe hacerse desde Safari. |
| **Tablet Android** | Igual que en Android. |
| **Windows / Mac** (Chrome/Edge) | Ícono de instalar en la barra de direcciones. |

Se abre en pantalla completa, con el logo, y **abre aunque no haya internet**: las pantallas y las lecturas de las
mangueras que se escriban quedan guardadas en el equipo y se suben solas al volver la señal.
Registrar un suministro sí necesita conexión (muestra el error y se puede reintentar).

## 2. Notificaciones ("Falta cerrar la jornada")

1. Al entrar (ya instalada), la app muestra la barra **"Activa las notificaciones…"** → **Activar avisos** → *Permitir*.
2. Desde ese momento el equipo recibe el aviso **aunque la app esté cerrada**:
   * 7:00 a. m.: si una jornada quedó abierta el día anterior.
   * 6:00 p. m.: si la jornada de hoy sigue abierta.
   * Al tocar el aviso se abre la pantalla para cerrar esa jornada.
3. Los supervisores y administradores además reciben la alerta **"Cierre pendiente"** en la campana y en *Alertas*.

Requisitos y límites:
* **iPhone/iPad**: solo funcionan con la app **instalada en la pantalla de inicio** y iOS **16.4 o superior**.
* Si el usuario cierra sesión, ese equipo deja de recibir sus avisos (para no mezclar usuarios en equipos compartidos).
* El servidor debe tener las claves `VAPID_*` y `CRON_SECRET` (ver `docs/GUIA-SUPABASE.md`).
* Probar sin esperar al horario: `curl -H "Authorization: Bearer TU_CRON_SECRET" https://TU-DOMINIO/api/tareas/recordatorio-cierre`
  (requiere que exista una jornada abierta pendiente; devuelve cuántos avisos se enviaron).

## 3. Qué pasa si el operario sale de la app
* Lo que escribió en las lecturas M1/M2 y en el checklist **se guarda solo** en el servidor (y en el equipo si no
  hay señal). Al volver a entrar, todo sigue ahí.
* Otro operario que entre más tarde el mismo día ve **la misma jornada** (hay una sola por día).
* Solo hay **un cierre por día**. Si nadie lo hace, aparece una barra roja en toda la app y llegan los avisos.
* Una jornada pendiente de días anteriores se puede cerrar con el enlace "Ir a cerrarla".

## 4. Generar el APK (Android) — opcional

Un APK "tipo TWA" es la misma PWA dentro de un envoltorio Android: **no se reescribe nada** y se actualiza solo
cuando se despliega la web. Las notificaciones push funcionan igual que en la PWA.

**Requisitos**: dominio propio con HTTPS **fijo** (no una URL de *preview* de Vercel), Node 18+, JDK 17 y Android
SDK (Bubblewrap los instala la primera vez).

```bash
npm install -g @bubblewrap/cli
mkdir apk && cd apk
bubblewrap init --manifest https://TU-DOMINIO/manifest.webmanifest
#   Package ID sugerido: co.guaicaramo.combustible   |  se crea una llave (keystore): GUÁRDALA y su clave
bubblewrap build          # genera app-release-signed.apk (y app-release-bundle.aab para Play Store)
bubblewrap fingerprint    # muestra la huella SHA-256 de la llave
```

Luego se le dice a Android que el APK es de este dominio, creando **`public/assetlinks.json`** (ya está servido en
`/.well-known/assetlinks.json` por el servidor) con la huella:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "co.guaicaramo.combustible",
    "sha256_cert_fingerprints": ["AA:BB:...:HUELLA_SHA256"]
  }
}]
```

Desplegar, y comprobar que `https://TU-DOMINIO/.well-known/assetlinks.json` responde el JSON. Sin este archivo el
APK muestra una barra de navegador arriba.

**Cómo entregarlo**
* **Directo**: pasar el `.apk` por WhatsApp, USB o un enlace; en el equipo permitir "instalar apps de orígenes
  desconocidos". Sin costo.
* **Play Store**: cuenta de desarrollador de Google (pago único, unos 25 USD) y subir el `.aab`.
* **iPhone**: no existe APK. Se usa la PWA (sección 1). Una app en App Store requiere cuenta de Apple (unos 99 USD/año).

## 5. Sobre Flutter / app nativa
Sirve para tablets y celulares (Android, iOS y web), pero **no hace falta** para lo que se necesita (instalar,
recibir avisos, trabajar sin señal): la PWA + APK ya lo cubren y comparten el mismo código y la misma base de datos.
Una app nativa solo se justificaría para funciones de hardware (Bluetooth con el surtidor, NFC, escáner continuo).
Si algún día se hace, consumiría la misma API `/api`, cambiando la sesión por cookie a una por token.

## 6. Actualizar la app instalada
Al desplegar una versión nueva, los equipos la reciben la próxima vez que se abra con internet. Para forzar que se
refresque el guardado sin conexión, cambiar `VERSION` en `public/sw.js`. Si se agrega un archivo a `public/js` o
`public/css`, agregarlo a la lista `PRECACHE` del mismo archivo (`npm test` avisa si falta).

## 7. Lista de prueba en dispositivo real (después de desplegar)
- [ ] Instalar en un Android y en un iPhone; abre a pantalla completa con el logo.
- [ ] Escribir M1 inicial, cerrar la app por completo, abrirla: el valor sigue ahí.
- [ ] Activar avisos; ejecutar el `curl` del cron con una jornada abierta: llega la notificación y al tocarla abre el cierre.
- [ ] Modo avión: abre la app, escribir una lectura ("Sin conexión: guardado en este equipo"), quitar modo avión: se sube sola.
- [ ] Cerrar sesión en el equipo: ya no llegan avisos de ese usuario.
