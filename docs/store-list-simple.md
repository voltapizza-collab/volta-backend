# Lista de tiendas — 6 de octubre de 2026

La lista muestra cuatro columnas: tienda y ubicación, estado de pedidos online, métodos de entrega y Gestionar. La recepción se muestra como un único indicador; las explicaciones y los controles de apertura/cierre quedan dentro de Gestionar. Desde ese diálogo siguen disponibles edición, menú, horarios, POS, reporte, reservas, habilitación y eliminación con la confirmación existente. El estado no se altera al consultar la lista.

El backoffice con partner fijo consulta `/partners/by-id/:id`, no `/partners`. La consulta global estaba correctamente bloqueada por la autorización, pero hacía aparecer el error de carga junto a tiendas cargadas por un segundo efecto. Se elimina esa carga duplicada, se oculta el selector innecesario y se añade reintento para fallos reales. Global Manager conserva su selector de partners.

Verificaciones: 8 pruebas de interfaz; compilación completa correcta. En producción, la cuenta MyCrushPizza recibe HTTP 200 tanto para su partner como para sus tiendas, mientras `/partners` devuelve el 403 esperado. No se modificaron tiendas ni recepción al comprobarlo. La sesión de comprobación se revocó.

Revisión visual local no completada: el navegador rechazó abrir una pestaña con error de conexión por su política de URL. El diseño incluye filas adaptadas a pantallas estrechas y diálogo nativo con foco y cierre por Escape.

La nota `store-list-simple-2026-10` se activa después de comprobar el despliegue del storefront.
