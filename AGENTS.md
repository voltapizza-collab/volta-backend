# Novedades para los administradores de Volta

Escribir siempre «backoffice» en una sola palabra, también en las traducciones.

Cuando una entrega cambie una función visible para los usuarios del backoffice o de su negocio, incluir una nota breve en `data/backofficeAnnouncements.js` junto con la mejora. Explicar qué cambió y cómo aprovecharlo. No publicar mensajes de commit en bruto ni anunciar funciones antes de que estén disponibles.

Consultar `docs/backoffice-notifications.md` para el formato, las fechas, los destinatarios y los destinos admitidos. Mantener los identificadores de notas ya publicadas; aumentar la revisión solamente cuando deban leerse de nuevo. Las refactorizaciones internas sin cambios de comportamiento no necesitan un cartel.

Incluir las traducciones de cada nota para EN, IT, FR y PT en `translations`, con el texto español en los campos raíz. Traducir también `detail` y `actionLabel` cuando existan.

Ejecutar `node --test tests/backofficeNotifications.test.js` si se modifica el catálogo o el sistema de avisos. Si la mejora afecta también al storefront, coordinar ambos despliegues para que la nota describa una función disponible.
