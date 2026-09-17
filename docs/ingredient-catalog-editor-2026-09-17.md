# Edición y retirada reversible de ingredientes

Implementado en el workspace el 17 de septiembre de 2026. Pendiente de migración y publicación en el entorno remoto.

## Comportamiento

- Global Manager conserva Activo/Inactivo y Uso global. Su explicación indica tiendas activas con el ingrediente habilitado y productos activos; no ventas ni cantidades.
- Editar abre el mismo formulario que Añadir, con siete nombres, traducciones pendientes, foto, categoría y estado. Carga la ficha completa antes de permitir guardar. Los identificadores existentes son de solo lectura.
- Eliminar abre una confirmación. Devuelve el ingrediente a la bolsa general conservando ID, foto, traducciones, descripciones, alias, alérgenos y demás campos de su ficha.
- La retirada exige confirmación explícita también en el servidor. Cualquier vínculo con tiendas, recetas, extras, usos de categoría, perfiles de negocio o mapas semánticos la bloquea, incluyendo tiendas/configuraciones inactivas.
- Añadir una ficha conservada recupera el mismo ID y su estado anterior. Puede revisarse antes de recuperar. No duplica el ingrediente.
- Una subida fallida o un guardado fallido conserva la ficha anterior. Al sustituir la foto, la anterior se elimina del proveedor solo después del guardado completo.
- Frente a un servidor antiguo o a una bolsa inaccesible, el catálogo disponible sigue visible y sus acciones de escritura quedan deshabilitadas. Así el nuevo botón nunca llama accidentalmente al antiguo borrado físico.

## Lista maestra y límites de seguridad

La maestra `volta-storefront/src/data/ingredientMasterSource.json` permanece separada de las fichas operativas. Ninguna acción de este panel escribe en ella. El servidor usa `data/ingredientMasterCatalogue.json` como referencia de identidades permitidas. La validación del storefront impide retirar o renombrar cualquiera de las 3.014 claves protegidas y comprueba que la copia del servidor coincide con la maestra cuando ambos repositorios están presentes.

La tabla `IngredientCatalogState` registra la pertenencia a la bolsa y el estado previo. Su clave foránea usa `ON DELETE RESTRICT`; la nueva ruta DELETE archiva, no elimina el registro ni su imagen. Si una ficha antigua no tiene una identidad maestra inequívoca, se bloquea la retirada para evitar perder su acceso desde la bolsa.

Esto protege la integridad dentro de este flujo, **no constituye una nueva autorización administrativa**. El acceso actual a Global Manager depende de validación en el navegador y estas rutas no tienen sesión administrativa validada por el servidor. Para protección de acceso real sigue pendiente reemplazar ese mecanismo y añadir autorización a todas las rutas administrativas, además de las políticas de revisión/acceso del repositorio. No se ha anunciado que esa autenticación esté implementada.

## Publicación

1. Revisar/aplicar `prisma/migrations/20260917120000_preserve_ingredient_catalog/migration.sql` mediante el procedimiento de migraciones del entorno. Solo añade una tabla con índices y FK; no elimina ni transforma ingredientes existentes.
2. Generar el cliente Prisma y publicar/reiniciar el backend actualizado.
3. Comprobar `GET /ingredients` y `GET /ingredients/catalog-pool`, y publicar el storefront coordinadamente.
4. La nota `ingredientCatalogEditorAnnouncement` está preparada en ES/EN/IT/FR/PT, con fecha nula y fuera del catálogo activo. Activarla únicamente cuando la función esté disponible.

La configuración del workspace apunta a una base remota: no se ha aplicado allí la migración durante este trabajo. El cliente Prisma estándar estaba bloqueado por un proceso Node que usa su DLL en Windows. Se validó el esquema y se generó correctamente un cliente separado para la prueba aislada; el proceso activo no se interrumpió.

Este cambio corresponde a Global Manager y no requiere un APK nuevo. La actualización de pago del POS 0.3.9 ya instalada por USB pertenece a la entrega anterior.

## Verificación

- 23 pruebas de interfaz: carga completa, siete idiomas, errores y reintento, cancelación, confirmación, bloqueo por uso, servidor antiguo y retirada/recuperación conservando nombres y foto.
- 58 pruebas de ingredientes del backend, incluidas 12 nuevas de conservación, todos los tipos de vínculos, identidad protegida y fallos de imagen. Las 7 pruebas de avisos también pasan.
- Compilación de producción y validación de 3.014 entradas / 14 categorías.
- Prisma schema válido y cliente aislado generado.
- MySQL 8 local, base desechable `ingredient_catalog_test` en 127.0.0.1:3309: se ejecutó el SQL exacto de la nueva migración, retirada, filtro del catálogo, lectura de bolsa, bloqueo de borrado físico por FK y restauración con mismo ID/foto/descripciones/idiomas. No se conectó esa prueba a la base remota. El servidor de prueba se apagó al terminar.
- Recorrido visual con datos simulados en Edge, 1440 y 393 px: editor, guardado y confirmación; sin errores JavaScript ni desbordamiento horizontal. Capturas en `../output/ingredient-semantics/`.
