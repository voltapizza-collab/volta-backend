# Acceso sencillo al backoffice

Solicitado por Luigi el 6 de octubre de 2026. En cuentas sin contraseña personal, usuario y contraseña inicial coinciden con `Partner.slug`. Una contraseña personal guardada siempre tiene prioridad. No se modifican las contraseñas existentes ni los accesos POS o Global Manager.

La bienvenida enlaza directamente al login del negocio y explica el acceso inicial. El reenvío no genera un cambio de contraseña ni anula enlaces de recuperación solicitados por el usuario. Desde Ajustes → Cuenta y contraseña se puede cambiar voluntariamente la contraseña, introduciendo la actual y confirmando la nueva. Se acepta cualquier contraseña no vacía de hasta 1024 caracteres, sin requisitos de complejidad. Se conserva la recuperación opcional por correo para quien olvide su contraseña personal.

Recordar dispositivo está activado por defecto: sesión de 90 días guardada por negocio en el navegador, sin guardar contraseñas. Desactivarlo mantiene la sesión en la pestaña con caducidad de un día. Se verifica la sesión con el servidor antes de mostrar los datos. El cambio de contraseña invalida las sesiones anteriores y renueva la del dispositivo donde se cambia. Cerrar sesión revoca el token y elimina su copia local.

Los contratos nuevos incluyen la responsabilidad de custodiar las credenciales y la posibilidad de cambiarlas voluntariamente. Los documentos ya emitidos conservan su contenido.

La revisión 2 de `business-access-2026-10`, en `simpleBackofficeAccessAnnouncementDraft`, se publica después de verificar ambos servicios. Contiene ES, EN, IT, FR y PT.
