# Persona 1: calidad e infraestructura

Rama de trabajo: `codex/persona-1-calidad-infra`, desde `develop`.

## TRZ-122: tests y seeds

Los 417 tests originales pasaron después de la migración mecánica a Vitest.
`npm test` incluye `src` y `tests/unit`; se conserva `node:assert/strict`.
Se eliminan el hook de resolución de Node y c8. La cobertura tiene un único
reporte y exige al menos 90% de líneas para `stock-import/rows.ts`.
Vitest usa dos workers para limitar memoria y evitar tiempos de espera bajo carga.

Las siete configuraciones de Playwright se reúnen en proyectos dentro de
`playwright.config.ts`. La selección y los entornos están documentados en
[testing](testing-demo.md). El listado descubre todos los proyectos sin Docker.

El seed se movió a `supabase/seeds/001_demo.sql` sin cambiar contenido (mismo hash
Git). Un arranque local nuevo aplicó las migraciones y el seed: tres usuarios demo
y un depósito. No se modificó ninguna base remota.

## TRZ-119: CI

Workflow para PR/push a `develop` y `main`: Node 20, npm ci, lint, typegen + tsc,
Vitest y build con Supabase ficticio. Badge en README. `*.tsbuildinfo` ya estaba
ignorado y no había archivos de ese tipo versionados.

Se actualizó Next y su configuración ESLint de 16.4.3 a 16.4.6 porque la versión
anterior bloqueaba el primer arranque/build por avisos de seguridad. El build
pasó con 16.4.6; una auditoría posterior ya no informó vulnerabilidades de Next.
Esto no equivale a declarar libres de vulnerabilidades todas las dependencias.

Pendiente de GitHub: subir/revisar PR, medir ejecución remota y exigir el check
`CI` en la protección de ambas ramas (responsable: dueña del repositorio).

## TRZ-114: contrato ERP

Suite compartida para mock y ERPNext con HTTP y persistencia simulados. Odoo
figura como pendiente de TRZ-113. Dos casos se omiten con motivo en el mock:
HTTP 403 separado y fallo de transporte, porque no los simula.

Se confirmó con la responsable de persona 1 que el mock debe exigir despacho
previo para registrar entrega/adjunto. Devuelve not_ready reintentable y el test
comprueba que el reintento funciona después del despacho.

Prueba de sensibilidad: una modificación temporal del mapeo de ERPNext a fecha
`31/12/2027` hizo fallar la suite. Se restauró el código antes de continuar.

## TRZ-117: importación

Casos tabulados de reglas y tests de las acciones reales: límites de archivo,
permisos, dry-run, filas inválidas, duplicados y errores de depósito. Se conserva
la política ya implementada de procesar solo las filas válidas.

La suite SQL `supabase/tests/ush1_stock_import.sql` pasó contra Supabase local y
terminó con rollback. Verifica las reglas dentro de PostgreSQL, incluidos modos
manual/ERP, depósitos de otra empresa o inactivos y creación de eventos.

## TRZ-120: términos neutrales

Se reemplazan nombres de documentos del proveedor en mensajes y comentarios del
código de negocio. La búsqueda sin distinguir mayúsculas de frappe, erpnext,
stock entry, pick list, delivery note y doctype no devolvió resultados en `src`
fuera de `src/lib/erp` y tests. No se editaron migraciones históricas.

La expresión CODE sigue siendo una regla de TrazFlow, sin cambiar los códigos
aceptados. Decisión documentada en [ADR](decisiones/001-testing-y-limites-erp.md).

## TRZ-32: órdenes

Filtros combinables por estado/distribuidora aplicados en servidor junto al
alcance de empresa. Selección persistente en URL, limpiar filtros y estado vacío
específico. Tests de validación y composición de la consulta.

## TRZ-73 y TRZ-124: documentación

Onboarding inicial según el código vigente; explica registro, solicitud,
aprobación/rechazo, revocación/restauración y asignación de choferes. El vínculo
operador-distribuidor del ticket histórico ya no existe. Revisar tras TRZ-112,
TRZ-74 y TRZ-31. README corrige líneas de órdenes importadas, testing, seeds,
roles y arquitectura. El cierre final espera el resto de los merges, datos del
equipo, URL pública verificada, C4 definitivo y revisión cruzada. El README ya
incluye una captura real del navegador con datos sintéticos.

## TRZ-118: acceso pendiente

No se dispone de consola Oracle ni clave SSH de erpnext-vm. La conexión Vercel
respondió 403 para el equipo configurado y el intento de solicitar autorización
respondió 404. No se cambió infraestructura, dominio, red ni credenciales.
Coordinar con quien administra Oracle y Vercel antes de completar esta historia.

## Validación local

- ESLint: aprobado.
- TypeScript con generación de rutas: aprobado.
- Vitest con cobertura: 76 archivos; 494 aprobados, 2 omitidos con motivo y 1 todo.
- Cobertura de rows.ts: 100% de líneas, ramas y funciones.
- Build de producción: aprobado con Next 16.4.6.
- Supabase: arranque nuevo con migraciones y seeds aprobado.
- SQL de importación: aprobado con rollback.

Las ejecuciones interrumpidas por falta de navegador o saturación de memoria no
se cuentan como aprobación. Se verificaron tres casos de navegador: entrega del chofer a 1280 y 390 px,
y filtros de órdenes en celular. El caso de filtros también verifica el reinicio
de ambos selectores al limpiar y ausencia de desborde horizontal. Captura en
`docs/images/orders-filters-mobile.png`. No se afirma una ejecución completa de
las suites comerciales, forecast ni los proyectos de Playwright con Supabase local.
