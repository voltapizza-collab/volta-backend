# Punto de control del catálogo — 25 de septiembre de 2026

Expansión cerrada por decisión del usuario en el lote 36, con 3.728 fichas y 14 familias. Se conserva la proyección del catálogo y la taxonomía estática compartida con el storefront. No se realizan nuevas altas, despliegues ni escrituras en bases de datos.

Fuente normalizada SHA-256: `392160acfeff4a4cb5ef0ef4737a4e79ec33dd816faf7ef63a7e7af33106c432`.

La auditoría versionada en `../volta-storefront/scripts/audit-ingredient-closure.cjs` comprueba los 36 lotes, sus bases históricas y la correspondencia de estos archivos con el storefront. Pasó también sobre una exportación aislada del índice exacto de los dos commits, junto con las 11 pruebas del importador.

La suite general del árbol de trabajo del backend pasó con 270 pruebas aprobadas y 1 prueba MySQL omitida por falta de configuración. Ese árbol incluye modificaciones previas que quedan fuera de este commit: no se presenta este resultado como auditoría integral de su entrega.

El [informe de cierre](../../volta-storefront/docs/ingredient-master-closure-2026-09-25.md) recoge las 482 pruebas aprobadas, la compilación, el alcance del punto de control y los próximos cambios por concretar. Las altas siguen pendientes de revisión editorial, formulaciones, imágenes y traducciones. La entrega de la aplicación, la integración operativa y Sunmi siguen pendientes.
