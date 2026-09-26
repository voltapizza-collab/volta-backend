# Reanudación de la auditoría — 24 de septiembre de 2026

Se retoma el bloque interrumpido por límite de uso el 18 de septiembre a las 14:05 (Madrid). Luigi confirma que el Sunmi físico todavía no está disponible y pide continuar las comprobaciones locales. Se mantiene pendiente la publicación coordinada.

## Resultado de la comprobación local

- Backend: 269 pruebas satisfactorias en la suite general; la prueba MySQL que se omite sin configuración se ejecutó después contra `coupon_flow_test` y también pasó. Total: 270 pruebas, sin fallos.
- Frontend: 27 suites, 195 pruebas satisfactorias. Incluyen conservación del carrito, segunda confirmación cuando cambia el envío, revisión manual, acceso para corregir una dirección fuera de cobertura y avisos en ticket/POS y contenidos de impresión Windows/Sunmi.
- Auditoría HTTP/MySQL del reparto: 28 escenarios satisfactorios. Las ventas de prueba se revierten antes del pago, mapas simulados y las 43 tablas de la copia quedan restauradas. Evidencia actualizada: [checkout-delivery-audit.json](checkout-delivery-audit.json).
- Catálogo maestro validado: 3.014 entradas y 14 familias.
- Compilación completa correcta: `main.5290db75.js` y `main.6cd59d28.css`. Copiada a `volta-storefront/build` y servida en localhost.
- API local: salud correcta, inventario con 131 ingredientes y carta con 48 platos, HTTP 200 y `Cache-Control: no-store`. Tres lecturas de carta: 404, 212 y 200 ms. Son muestras de una copia local, no una medida de rendimiento en producción. Evidencia: [resume-local-checks-2026-09-24.json](resume-local-checks-2026-09-24.json).
- Navegador: carta compilada cargada en `/mycrushpizza/plaza-diario`, con productos, categorías y controles; panel Ingredients del Global Manager muestra los 131 ingredientes agrupados por las nuevas familias. Los escenarios de confirmación de reparto y tickets se verificaron con las pruebas automatizadas, sin realizar una compra desde el navegador.

No fue necesario cambiar código funcional para cerrar esta verificación. No se publicaron avisos ni se desplegó producción.

## Entorno recuperado

Backend en `http://localhost:8080`, con `NODE_ENV=test` (worker de reseñas detenido), conectado a la copia MySQL de loopback `ingredient_taxonomy_rehearsal`, no a la base compartida. Cliente Prisma aislado mediante `.cache/taxonomy-client-loader.mjs`. Frontend en `http://localhost:3000`, compilado contra ese backend. Se deshabilitaron las claves de SMS, Stripe y geocodificación para este proceso de ensayo.

Los datos son la copia recuperada de la auditoría anterior. No representan pedidos, existencias ni ventas actuales de producción. Los registros de esta sesión están en `tmp/resume-2026-09-24-*.log` desde la raíz del workspace; no incluyen credenciales de conexión.

## Siguiente punto de trabajo

1. Confirmar la composición de Pavo, las cremas y Tempura. La pregunta se volvió a presentar a Luigi; sin respuesta, conservar la clasificación provisional y las identidades. Las otras fichas ambiguas siguen documentadas en [ingredient-audit-points-1-4-2026-09-18.md](ingredient-audit-points-1-4-2026-09-18.md).
2. La reparación exacta de `R�cula` a `Rúcula` sigue preparada y ensayada; falta aplicarla a los datos operativos durante la entrega acordada.
3. Con el Sunmi físico: actualizar la aplicación, comprobar autenticación/sincronización, activar y desactivar ingredientes por categoría y verificar tickets de retiradas y de reparto con revisión manual.
4. Antes de publicar: completar carga representativa y revisión de entrega, respaldo y publicación coordinada de backend, storefront y POS, junto a sus novedades. La prueba local no cierra la auditoría integral de producción.
5. Actualización por instrucción posterior de Luigi: priorizar cobertura cotidiana de las 14 familias. 3.683 fichas locales. Revisión inicial de 248 necesidades básicas: 227 localizadas, 10 por aclarar y 11 sin ficha específica localizada. No es una certificación de cobertura completa. Próximo bloque conjunto: huecos cotidianos, alcances ambiguos y nombres de búsqueda. La referencia de 5.000 deja de dirigir la prioridad. [Balance y cola conjunta](../../volta-storefront/docs/ingredient-master-coverage-report-2026-09-24.md). Sin cambios en catálogo, taxonomías, inventarios o base de datos durante esta revisión. La compilación más reciente es la del lote 30; la sección anterior conserva comprobaciones históricas. Verificación visual pendiente; evitar navegador integrado durante el diagnóstico de cierres de Codex.

La alternativa sin ruta verificada conserva la política existente: tarifa base calculada en el servidor, nueva confirmación del cliente y revisión manual por la tienda. No se ha decidido cambiarla por bloqueo del pago.
