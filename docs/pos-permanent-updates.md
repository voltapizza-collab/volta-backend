# Distribución permanente de Volta POS

## Entrega del 3 de octubre de 2026

### Consulta diaria y decisiones con cierre inmediato — 0.3.20

0.3.20/código 23 sustituye la consulta cada 4–6 minutos por una consulta al abrir o volver al primer plano y una consulta diaria desde las 15:00 del reloj local si no se consultó ya ese día. Se conserva el día de la última consulta. Los errores mantienen el reintento con espera creciente. Las comprobaciones para ejecutar una autorización inmediata o llegada a su hora siguen cada 30 segundos y la preparación se revalida contra el servidor; el cambio de frecuencia no pospone una instalación autorizada hasta el día siguiente. Los reportes de salud siguen siendo independientes de la búsqueda de versiones.

El recordatorio abre el diálogo como máximo una vez por día local, al abrir Volta o desde las 15:00 si permanece abierta. El día mostrado se guarda en preferencias Android y sobrevive a reinicios. No interrumpe otro diálogo abierto; espera al siguiente refresco local de estado. Una autorización inmediata o programación vigente suprime el recordatorio. El aviso discreto y el acceso manual por el menú siguen disponibles. Guardar «Actualizar ahora», «Guardar programación» o «Dejar pendiente» cierra el modal sin una segunda confirmación; un error mantiene el modal abierto. La programación conserva su fecha y su ventana de autorización de una hora.

Validación: nueve pruebas React del diálogo, pruebas Java de cadencia (apertura, persistencia por día, límite de las 15:00 y cambio de horario), límites de consentimiento y ocho pruebas del catálogo. Nota administrativa traducida preparada fuera del feed hasta la distribución a sus destinatarios. La APK firmada se publicó y asignó únicamente al SUNMI V3 002 por el canal permanente. Evidencias y metadatos en `../../output/pos-daily-2026-10-03/`; pendiente de instalación y verificación física. Su 0.3.19 instalada sigue usando la cadencia anterior al recibir 0.3.20; la verificación física del comportamiento nuevo debe hacerse después de instalarla, con la siguiente versión asignada.

### Versión sin sufijo técnico y corrección de reapertura

0.3.19/código 22 elimina el sufijo `-https` del `versionName` real del APK; el pie y los avisos muestran el número de versión sin esa etiqueta. La configuración de conexión sigue usando HTTPS y el servicio permanente. El aviso explica que la aplicación se cierra y, si aparece el escritorio, se abre desde su icono. Se mantienen las acciones principales «Actualizar ahora» y «Ahora no», sin botón de comprobación manual. APK firmada publicada y asignada solo al SUNMI V3 002; pruebas React (6) y de avisos (8) correctas. Se comprobó el manifiesto final y que el bundle activo no contiene el botón retirado. Evidencias en `../../output/pos-version-2026-10-03/`.

La 0.3.18 fue instalada con decisión `now`: descarga a las 10:24:23 UTC, instalada a las 10:24:27 UTC y `healthy` a las 10:25:58 UTC, conservando identidad y sesión. No hubo decisión de programación: la prueba física de hora programada sigue pendiente y puede hacerse con 0.3.19. El usuario aclara que termina en el escritorio y debe abrir Volta manualmente. Esta aclaración sustituye la confirmación anterior de reapertura automática; se corrigió la evidencia anterior y se guardó `../../output/pos-scheduled-2026-10-03/verification-corrected.json`. La recepción y aspecto del aviso de 0.3.19 en la 0.3.18 instalada requieren observación en el terminal.

### Aviso simplificado y prueba programada

0.3.18-https/código 21 retira «Comprobar actualizaciones» del diálogo React. La consulta automática continúa; las acciones principales son «Actualizar ahora» y «Ahora no», con programación o dejar pendiente dentro de esta última. La autorización inicial de Android sigue apareciendo únicamente si falta el permiso necesario. Publicada y asignada al SUNMI V3 002 para una prueba programada, con evidencias en `../../output/pos-scheduled-2026-10-03/`. Las seis pruebas React, ocho de avisos, la compilación y las pruebas Java de límites/expiración del consentimiento pasaron. La confirmación física de la programación se registra por separado; publicar la APK no equivale a verificar esa programación.

Backend publicado en Railway: `7f70e78d-7e4d-46e7-a29d-ba3082b9f6e1` (SUCCESS). Migración aplicada y comprobada. Se publicaron 0.3.16/código 19 para migración inicial y 0.3.17/código 20 como actualización de comprobación; esta última conserva las funciones de la anterior y permite comprobar el recorrido completo. Código 20 asignado únicamente a `c68ea9fd-04bb-4b96-8b1b-1d700488b473` (SUNMI V3 002, vigoCity).

Validación: 46 pruebas de backend correctas; prueba real de MySQL local; pruebas Java de consentimiento y operaciones; APKs con firma original verificadas. En producción se usó una identidad temporal de prueba para consultar, descargar y verificar el hash, preparar, reportar, rechazar repeticiones y retirar la asignación. Se eliminó esa identidad al terminar. Evidencia del servicio: `../../output/pos-permanent-2026-10-03/service-verification.json`.

**Prueba física completada:** después de instalar 0.3.16 por USB, se comprobó que el cable estaba desconectado. El usuario aceptó 0.3.17 desde el POS; el servidor recibió `ready`, `installed` (código 20) y finalmente `healthy` a las 10:05:55 UTC del 3 de octubre. Se conservaron la identidad criptográfica y la misma sesión de tienda 2; el reporte confirma primer plano e impresora lista. Corrección posterior del usuario: la instalación devuelve al escritorio y es necesario tocar el icono de Volta. La reapertura automática no se considera verificada. Evidencia: `../../output/pos-permanent-2026-10-03/final-verification.json`. Esto valida ese recorrido en esta unidad; no equivale a una prueba de carga de toda la flota ni a imprimir físicamente un ticket en esta sesión.

## Arquitectura

`https://api.voltapizza.com/api/pos/updates` se monta dentro del router de identidad existente, después de autenticar la firma P-256 del terminal y antes de exigir una sesión de tienda. No depende del ordenador del desarrollador ni de túneles. El registro de versiones y asignaciones reside en MySQL; las APKs residen en el bucket privado Railway `volta-pos-releases` (AMS). La ubicación física del bucket no aparece en las respuestas al POS.

- `PosSoftwareRelease`: SHA-256, paquete, código y nombre de versión, certificado, notas, clave del objeto, autor y fecha. Código y objeto únicos. Los datos publicados son inmutables mediante la herramienta; para cambiar notas o binario se publica otra versión. `enabled=false` retira una versión de todas las asignaciones.
- `PosUpdateAssignment`: una versión objetivo por dispositivo. La asignación no concede el consentimiento del operador. Se asignan hasta 100 dispositivos explícitos por transacción; no existe una asignación automática a toda la flota.
- `PosSoftwareStatus`: versión reportada, objetivo, estado, error, última consulta y último reporte. Los reportes antiguos no rebajan la versión conocida. Los cambios de estado quedan auditados; los latidos repetidos no multiplican el historial.

Las rutas `/check`, `/apk/:sha`, `/prepare` y `/report` mantienen el protocolo existente. `/prepare` comprueba otra vez la asignación, la retirada de la versión y la tienda de la sesión, y concede como máximo 10 segundos de permiso técnico. Publicar o asignar no instala nada por sí solo. El consentimiento para la APK exacta sigue guardado y comprobado en Android. No se cierra la tienda ni se exige vaciar pedidos persistidos en el servidor. El bloqueo local espera operaciones e impresiones en curso.

La descarga requiere la identidad autorizada y la asignación correspondiente. El servidor lee el objeto privado y valida tamaño y SHA antes de entregarlo; Android vuelve a comprobar contenido, paquete, versión creciente y certificado. El servidor mantiene como máximo 64 MiB de caché y dos descargas simultáneas del almacenamiento; devuelve un fallo reintentable cuando está ocupado. La caché no sustituye la comprobación de asignación en cada petición.

Al publicar se verifica la firma con `apksigner`, el manifiesto con `aapt2` y el certificado aprobado. Los objetos usan el SHA como nombre y escrituras condicionales `If-None-Match: *`; se vuelve a descargar la copia duradera antes de insertar la versión en la base de datos. No se alojan las APKs en Cloudinary: ese proveedor rechaza la extensión APK en esta cuenta.

Referencias del almacenamiento: [Railway Storage Buckets](https://docs.railway.com/storage-buckets) y [servir archivos privados](https://docs.railway.com/storage-buckets/uploading-serving).

## Configuración

En el backend, `POS_IDENTITY_ENABLED=true` debe mantenerse habilitado. Las credenciales se inyectan mediante referencias del bucket Railway:

```text
POS_S3_ENDPOINT=${{volta-pos-releases.ENDPOINT}}
POS_S3_BUCKET=${{volta-pos-releases.BUCKET}}
POS_S3_REGION=${{volta-pos-releases.REGION}}
POS_S3_ACCESS_KEY_ID=${{volta-pos-releases.ACCESS_KEY_ID}}
POS_S3_SECRET_ACCESS_KEY=${{volta-pos-releases.SECRET_ACCESS_KEY}}
```

Nunca copiar estas credenciales a la APK. El operador que publica usa además `POS_APK_CERTIFICATE_SHA256`, `ANDROID_BUILD_TOOLS` y `JAVA_HOME`. El certificado aprobado debe proceder de la instalación existente, no del archivo que se intenta publicar.

La migración `20261003120000_add_pos_software_releases` añade tres tablas sin modificar pedidos, sesiones o claves de dispositivo. El arranque existente aplica las migraciones con Prisma. Los registros históricos de `PosDeviceAudit` se conservan; `PosSoftwareStatus` se rellena con los siguientes reportes, por lo que una fila vacía no significa que un terminal esté sin instalar.

## Publicar, asignar y consultar

La CLI exige acceso de operador a la base de datos y al bucket; no se ha añadido un endpoint público de administración ni una pantalla de gestión de flota.

```text
npm run pos:releases -- publish APK METADATA_JSON ACTOR
npm run pos:releases -- assign SHA256 ACTOR DEVICE_ID [DEVICE_ID...]
npm run pos:releases -- status [CURSOR_DEVICE_ID]
npm run pos:releases -- list
npm run pos:releases -- unassign DEVICE_ID ACTOR
npm run pos:releases -- withdraw SHA256 ACTOR
```

El JSON de publicación contiene `packageName`, `versionCode`, `versionName`, `certificateSha256`, `title` y `releaseNotes`; `sha256` y `size` son opcionales pero, si existen, deben coincidir. La publicación no asigna terminales. Repetir una publicación idéntica es idempotente. Una asignación se rechaza si conocemos una versión instalada igual o superior. La retirada no desinstala ni revierte una versión ya aplicada. Una corrección necesita un código superior.

## APK y migración de los equipos de prueba

Las compilaciones HTTPS usan el dominio permanente por defecto. Otro origen exige `-AllowTemporaryUpdateChannel`, reservado para ensayos explícitos. No distribuir a tiendas APKs con ese parámetro.

La primera APK del canal permanente es `0.3.16-https`, código 19. Incluye la versión real en el pie. La detección ordinaria se distribuye entre 4 y 6 minutos mientras Volta está abierto y listo; Comprobar actualizaciones fuerza una consulta. Las decisiones de instalar y los horarios vencidos se evalúan cada 30 segundos. Los fallos tienen espera progresiva; se conserva el aviso conocido. No hay servicio de recepción en segundo plano ni arranque automático tras reiniciar Android.

El procedimiento acordado es preparar inicialmente cada terminal por USB, instalando con `adb install -r` la APK de canal permanente. Las actualizaciones posteriores se distribuyen por internet. El 3 de octubre se instaló 0.3.16/código 19 por USB sobre 0.3.14/código 17 en el SUNMI `VA08253N40979`, sin desinstalar ni borrar datos; Android confirmó la sustitución y se abrió Volta. La versión 0.3.17/código 20 quedó asignada para comprobar el siguiente paso con USB desconectado y aceptación del usuario en el POS.

Las antiguas APKs 0.3.14 apuntan a un túnel caducado y no pueden descubrir otro origen por sí mismas. Como alternativa cuando no se dispone de USB, el operador puede generar un enlace privado de una hora:

```text
npm run pos:releases -- migration-link SHA256 PRIVATE_OUTPUT_JSON ACTOR
```

Se abre el enlace en el navegador del terminal y se acepta la actualización normal de Android. No desinstalar Volta ni borrar datos. Puede ser necesario autorizar al navegador como origen de instalación. La APK tiene el mismo paquete y firma, por lo que es una sustitución que conserva los datos; la conservación real de identidad y sesión debe verificarse en el equipo. Tras esta migración, las actualizaciones siguientes se ofrecen desde Volta. El enlace es un acceso temporal al archivo; el servidor de actualizaciones permanente no caduca con él.

## Validación y límites

`node --test tests/posUpdates.test.js tests/posIdentity.test.js tests/posUi.test.js tests/backofficeNotifications.test.js` verifica autenticación, asignaciones, retirada, integridad, reportes y catálogo. `scripts/verifyPosReleaseDatabase.js` exige una base MySQL local vacía denominada `pos_updates_test`, especificada en `POS_TEST_DATABASE_URL`; prueba la migración real, restricciones únicas, rollback de lotes, concurrencia y persistencia tras reconectar. No ejecutar sobre producción.

Una respuesta HTTP correcta y una compilación firmada no prueban por sí solas la instalación Android: la comprobación física de esta entrega se describe arriba. Antes de extender a tiendas, repetir la validación en los modelos y versiones Android de destino, incluido un ticket físico y la operación habitual. No se ha realizado una prueba de carga nacional ni implementado rollback automático o arranque después de reiniciar Android. El usuario observa que, tras actualizar, vuelve al escritorio y debe abrir Volta desde su icono; no se garantiza reapertura automática. La publicación inicial debe ser acotada a terminales explícitos.
