# Paquetes de comida — implementación local, 24 de octubre de 2026

Los paquetes agrupan IDs de categorías existentes. Un negocio combina varios paquetes sin duplicar categorías. `Category.builderType` identifica NONE o PIZZA; los extras conservan su modelo y no activan constructores. Mitad y mitad permanece como capacidad independiente de categoría. No se modifican tamaños, marca, dominio, precios ni reglas de reparto.

## Administración y alta

- Global Manager → Categorías y paquetes: categorías y plantillas de paquetes.
- Alta → Datos del negocio → después del nombre comercial: selección múltiple; se guarda en borradores y resumen.
- Global Manager → Onboarding: revisión de paquetes de la solicitud.
- Global Manager → Partners: revisar el efecto y aplicar paquetes a un negocio existente.
- Las solicitudes y negocios conservan una instantánea de los paquetes seleccionados. Modificar o retirar una plantilla afecta a selecciones futuras, no sobrescribe asignaciones existentes. Para adoptar una composición nueva en un negocio existente, crear y asignar una nueva plantilla; la interfaz no aplica actualizaciones masivas.

Una invitación nueva exige seleccionar paquetes si había plantillas activas al crearla. Las invitaciones anteriores pueden continuar con el flujo anterior o seleccionar paquetes. La activación aplica las categorías dentro de la transacción existente y respeta su mecanismo de reintentos. Las categorías que siguen asignadas conservan visibilidad, orden y precios de base. Retirar un paquete no borra productos, existencias ni ventas; las categorías exclusivas se desactivan. Las categorías compartidas permanecen asignadas.

## Compatibilidad y controles

`Partner.foodConfiguration = NULL` identifica negocios anteriores que no han adoptado paquetes. No se les asigna un tipo de comida por inferencia. La migración preserva el constructor visual de categorías que ya eran personalizables. Nuevas categorías usan NONE por defecto.

Los negocios gestionados por paquetes no reciben automáticamente categorías nuevas ajenas. Los fallos de lectura no abren el catálogo global. El cargador común de carta/precios filtra categorías desactivadas y no asignadas; checkout rechaza combinaciones y constructores no admitidos. Los cambios administrativos requieren sesión global_admin y verifican la configuración esperada y la vista previa para evitar sobrescribir cambios concurrentes. Las asignaciones a negocios registran estado anterior, nuevo, rol y fecha.

## Publicación

1. Revisar los cambios de backend y storefront; realizar copia de seguridad de Partner, Category y PartnerCategory.
2. Aplicar `20261024120000_add_food_packages` y generar Prisma Client antes de arrancar el nuevo backend. No ejecutar el backend nuevo contra un esquema anterior.
3. Publicar backend y storefront coordinadamente. Las seis plantillas iniciales se crean en borrador, sin inferir correspondencias por nombre.
4. En Global Manager, asociar categorías reales a cada plantilla, comprobar constructor/mitad y mitad y activar las plantillas deseadas. Las categorías comunes se pueden incluir en varios paquetes.
5. Verificar una alta sin pizza y una mixta en un entorno de prueba, incluida la recepción del pedido en POS; revisar una pizzería existente. No realizar cobros ni comunicaciones reales para estas pruebas.
6. Publicar `foodPackagesAnnouncementDraft` únicamente cuando la función esté disponible y comprobada.

La implementación local no aplica esta migración a producción, no modifica negocios reales y no publica la nota. Si se revierte el despliegue, no basta con devolver el backend antiguo: sus consultas no respetan la configuración de paquetes. Mantener las tiendas nuevas cerradas o preparar un parche compatible; no eliminar datos ni columnas como recuperación automática.
