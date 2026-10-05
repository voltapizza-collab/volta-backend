# Accesos por negocio — punto 1 del onboarding

Implementación local del 4 de octubre de 2026. No desplegada. No se han enviado correos reales, cambiado contraseñas existentes ni aplicado migraciones a una base de datos real.

## Recorrido del comercio

1. Firma el contrato con el procedimiento actual.
2. El correo incluye `/backoffice/{partnerSlug}` y `/pos/{partnerSlug}/{storeSlug}`. La bienvenida contiene un enlace de un solo uso, válido durante 24 horas, para crear una contraseña de al menos 12 caracteres. El PIN del POS se sigue generando aleatoriamente; ya no se guarda en el expediente público del onboarding ni en el navegador.
3. Al entrar, el servidor comprueba la cuenta y su negocio. El navegador espera esa comprobación antes de montar los módulos privados. Una sesión de A no se restaura al abrir un enlace de B.
4. Las sesiones del navegador se guardan por negocio y superficie en `sessionStorage`, separadas entre pestañas. Los enlaces genéricos continúan mostrando login. Después de entrar, la URL identifica el destino.
5. Cerrar sesión revoca el token en el servidor. Cambiar contraseña o regenerar/desactivar el PIN invalida las sesiones correspondientes. Caducidad: un día para backoffice/Global Manager; siete días para POS web. El POS Android mantiene su autenticación de dispositivo existente.

Las cuentas antiguas sin hash de contraseña ya no admiten como contraseña su identificador público. Deben usar «restablecer contraseña» y recibir el enlace en el email asociado. Esa recuperación dura una hora y el consumo del enlace es atómico: dos envíos simultáneos no pueden establecer dos contraseñas.

## Autorización

`services/webAccess.js` se monta antes de las rutas de negocio, incluidas sus variantes `/api`. Las rutas públicas están enumeradas expresamente. Las demás requieren una sesión emitida por el servidor; las rutas privadas nuevas se rechazan hasta incorporarlas a la política.

Backoffice comprueba pertenencia de tiendas, clientes, pedidos, productos, promociones y reservas; valida referencias del cuerpo y de la consulta; acota listados al negocio. Las cargas multipart se comprueban después de leer sus campos. El POS web reutiliza el alcance operativo del POS nativo, restringido a su tienda. Las operaciones globales y la recarga manual de SMS requieren Global Manager. Los webhooks conservan sus verificaciones propias.

Global Manager deja de autenticar mediante una comparación de contraseña en JavaScript. Necesita usuario y hash configurados en el servidor. No se proporciona una contraseña predeterminada.

## Adaptaciones de las rutas públicas

- La tienda consulta `/api/myorders/queue-size`: devuelve únicamente el número de pedidos, sin clientes ni pedidos completos.
- Repetir pedidos exige justificantes firmados generados tras confirmar un pago. Se conservan los tres últimos en el navegador, separados por negocio y tienda, y caducan al año de crear el pedido. El teléfono filtra esos justificantes; por sí solo ya no permite recuperar datos. Los pedidos anteriores sin justificante guardado no aparecen en esta recuperación.
- Los nuevos SMS de reserva contienen un enlace de cancelación firmado y limitado a esa reserva. Los enlaces antiguos que solo contienen un número dejan de permitir cancelación anónima; el cliente puede contactar con la tienda y el backoffice puede tramitarla.
- Boost requiere el código del pedido, no basta un ID numérico. Los nuevos códigos de pedido incorporan aleatoriedad criptográfica. Los códigos históricos de seguimiento se conservan; no se han rotado ni enviado nuevos SMS a clientes existentes.
- Los avisos y el retorno de la compra de SMS conservan el negocio de destino. El servidor construye la URL de retorno desde su configuración y el negocio autenticado.

Estas adaptaciones son necesarias para que proteger el panel no deje rutas alternativas para consultar pedidos o modificar reservas.

## Preparación del despliegue conjunto

1. Configurar `VOLTA_ADMIN_USERNAME` y `VOLTA_ADMIN_PASSWORD_HASH`. El hash usa el formato `scrypt:salt:hash` de `hashWebPassword` en `services/webSessions.js`. Gestionar estos valores como secretos del servidor; no introducir la contraseña en código, commits o argumentos de comandos.
2. Configurar `PUBLIC_FRONTEND_URL` con el origen HTTPS real. Configurar una clave aleatoria y estable `WEB_ACTION_SIGNING_KEY` para los justificantes y cancelaciones. Si se omite, el código deriva la clave del secreto `DATABASE_URL`, sin valor público por defecto; cambiar esa fuente invalida los enlaces firmados.
3. Aplicar `prisma/migrations/20261004120000_add_web_sessions/migration.sql` siguiendo el procedimiento de migración del entorno. Se incluye preparación aditiva de la tabla; para entornos sin permisos DDL debe existir previamente. Las columnas de contraseña/recuperación de Partner utilizan la preparación aditiva ya existente. La tabla guarda hashes de tokens, no tokens utilizables. Programar la eliminación de sesiones caducadas como mantenimiento de base de datos.
4. Configurar `TRUST_PROXY_HOPS` únicamente con el número comprobado de proxies de confianza. El límite de acceso actual es de 15 intentos por IP y 15 minutos por proceso. Sin esa configuración, detrás de un proxy los clientes comparten su IP; con varias réplicas debe añadirse un límite común en el proxy o almacenamiento compartido.
5. Comprobar en preproducción la recuperación de las cuentas existentes, los emails de las tiendas y el acceso nuevo de Global Manager. Los cambios no importan sesiones antiguas sin verificar.
6. Desplegar backend y storefront juntos. Probar dos negocios y dos tiendas con datos de prueba: alta y correo, creación de contraseña, login, recuperación, sesión caducada, logout, PIN regenerado, avisos, retorno SMS, compra de cliente, repetición desde justificante y cancelación firmada. Comprobar también el terminal Android real.
7. Publicar `businessAccessAnnouncementDraft` en los cinco idiomas solo después de verificar ambos despliegues. Actualmente está fuera del feed.

No se han cambiado en esta entrega los estados de apertura de tiendas, precios del POS, alquiler, contrato económico ni cobro previo a la firma. La simplificación de «Activa» frente a «Abierta para pedidos» corresponde al punto 2.

## Verificación local

- 67 pruebas de backend: sesiones, autorización por negocio, firma y caducidad de acciones públicas, PIN, identidad nativa, recuperación concurrente, confirmación de pago, disponibilidad y avisos.
- 48 pruebas de frontend: espera de verificación, negocio incorrecto, caducidad, logout, ámbito POS, justificantes, inventario, pausa y avisos.
- Esquema Prisma validado. Compilación de producción del storefront comprobada; no equivale a un despliegue ni a una prueba con MySQL, SMTP, Stripe o terminal reales.

Las pruebas de autorización utilizan bases de datos simuladas y servidores HTTP locales. La verificación de preproducción del paso 6 sigue pendiente.
