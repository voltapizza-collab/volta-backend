# Incorporación de ingredientes desde Global Manager

El botón «Añadir ingrediente» abre un modal para buscar en la lista maestra por nombre, alias o categoría. La búsqueda comienza en todas las categorías; señala los ingredientes ya incorporados y tolera búsquedas sin tildes. «Buscar ya añadidos» despliega el filtro secundario del catálogo existente.

El operador selecciona un ingrediente, conserva o corrige su nombre español y completa ES, EN, IT, FR, PT, AR y ZH. «Traducir idiomas pendientes» rellena únicamente campos vacíos. Cambiar el nombre español en el modal limpia las traducciones para que no pertenezcan a otra identidad. Las respuestas tardías de otra selección se descartan.

`POST /ingredients/onboarding` guarda ingrediente, categoría semántica, siete traducciones y alias en una sola transacción con creación anidada. La categoría semántica se resuelve en el servidor a partir de la categoría del ingrediente. Las traducciones automáticas no se consideran revisadas: el nuevo ingrediente queda en `NEEDS_REVIEW`, con ES revisado y EN/IT/FR/PT/AR/ZH como borradores. El editor conserva los idiomas adicionales que ya admitía.

La foto es opcional: el modal permite seleccionar o arrastrar un archivo JPG, PNG o WebP de hasta 5 MB, verlo, cambiarlo o quitarlo. La vista previa es local; no se genera ninguna imagen ni se sube hasta pulsar «Añadir ingrediente». El archivo y los nombres viajan juntos como multipart (`payload` JSON e `image`); sin foto se conserva el cuerpo JSON.

La subida se realiza antes de la transacción. Si falla, no se crea el ingrediente y el modal conserva nombres y foto para reintentar. Si falla la base de datos después de subir, se intenta eliminar el archivo que ha quedado sin vincular. La foto se registra con `imageSource: MANUAL_UPLOAD` y el estado existente `GENERATED`, que significa pendiente de revisión visual; no implica que esta función genere imágenes.

La categoría se abre al terminar el alta y la fila queda resaltada. Los controles existentes permiten sustituir o revisar la foto después. Este cambio no modifica la lista maestra, no amplía ingredientes ni altera las reglas existentes de aprobación semántica o visual.

## Traductor

`POST /ingredients/translate` devuelve EN/IT/FR/PT/AR/ZH y conserva el español original. También lo utiliza el editor semántico para completar idiomas pendientes. Sustituye el anterior diccionario de palabras del navegador.

El proveedor predeterminado es MyMemory, mediante su API pública gratuita, sin clave. Solo se consulta `/get`, enviando el nombre español y el par de idiomas. No se contribuye al servicio mediante `/set`. Las traducciones son borradores editables: su calidad culinaria debe revisarse. Se conserva el adaptador OpenAI Responses con salida estructurada para instalaciones que lo configuren expresamente.

Variables del backend:

- `INGREDIENT_TRANSLATION_ENABLED=false`: desactiva las llamadas externas. Sin esta variable se utiliza MyMemory, salvo una configuración anterior con habilitación explícita y clave OpenAI.
- `INGREDIENT_TRANSLATION_PROVIDER`: `mymemory`, `openai` o `disabled`.
- `INGREDIENT_TRANSLATION_CHARACTER_LIMIT`: por defecto 4.500 caracteres de origen por día UTC, contando cada idioma solicitado; máximo 5.000. MyMemory publica una cuota anónima de 5.000 caracteres/día, compartida con otras solicitudes de la misma IP.
- `INGREDIENT_TRANSLATION_DAILY_LIMIT`: por defecto 200 solicitudes de ingredientes por día UTC; máximo 1.000.
- `INGREDIENT_TRANSLATION_CACHE_PATH`: archivo local; por defecto `.cache/ingredient-translations.json`, excluido de Git. En servidores con almacenamiento efímero debe apuntar a un volumen persistente.
- `OPENAI_API_KEY` y `INGREDIENT_TRANSLATION_MODEL`: solo para el proveedor OpenAI; modelo predeterminado `gpt-4.1-mini`. La clave nunca se incluye en el frontend.

Se reutilizan hasta 500 traducciones de ingredientes. La caché y los contadores sobreviven a reinicios cuando el archivo es persistente. Si un idioma falla, se conservan las respuestas correctas para que el reintento consulte solo el pendiente. Al agotarse la cuota, las traducciones ya guardadas siguen disponibles y se permite completar nombres manualmente. El límite del proveedor siempre prevalece, incluso si el archivo local no se puede guardar. Los contadores son por instancia; no coordinan varios servidores.

Hay un trabajo de traducción simultáneo, con hasta seis consultas MyMemory paralelas y un timeout de 18 segundos por consulta. OpenAI recibe nombre y categoría, usa `store:false` y un timeout de 25 segundos. Los errores al usuario no incluyen respuestas internas ni claves. Global Manager mantiene su autenticación actual en el navegador; este cambio no incorpora autenticación de servidor. Para un despliegue público, proteger estas rutas de administración en el servidor o proxy. Los límites locales no sustituyen controles de acceso ni presupuestos de proveedores de pago.

Referencias: [API MyMemory](https://mymemory.translated.net/doc/spec.php), [cuotas MyMemory](https://mymemory.translated.net/doc/usagelimits.php), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Comprobaciones

Backend: `node --test tests/ingredientOnboarding.test.js tests/ingredientSemanticAdmin.test.js tests/ingredientSemantics.test.js`.

Frontend: `node node_modules/react-scripts/bin/react-scripts.js test --watchAll=false --runInBand --runTestsByPath src/components/GlobalManager/IngredientOnboardingModal.test.jsx` y `npm run build`.

Las pruebas automáticas usan respuestas del traductor y almacenamiento simulados; cubren caché persistente, cuota, reintentos parciales, selección y arrastre de foto, validación, conservación del borrador y limpieza tras fallo. No crean ingredientes en la base real ni consumen traducciones de pago. La comprobación real del traductor utiliza «Aroma de setas» en el entorno local, sin dar de alta el ingrediente. Publicar frontend y backend juntos para disponer de las nuevas rutas.

Esta es una mejora interna de Global Manager. No se publica un aviso para los administradores de las pizzerías porque sus pantallas y disponibilidad del catálogo no cambian hasta que se incorporen y revisen ingredientes.

El alta utiliza siete idiomas. Árabe se muestra de derecha a izquierda y chino usa caracteres simplificados (`zh` en Volta, `zh-CN` en MyMemory). El editor de ingredientes existentes también puede completar AR/ZH aunque los otros cinco nombres ya estén rellenos. Las entradas antiguas de caché conservan sus cuatro traducciones y consultan únicamente AR/ZH al volver a utilizarse. No se modifica ni retraduce el catálogo existente automáticamente.
