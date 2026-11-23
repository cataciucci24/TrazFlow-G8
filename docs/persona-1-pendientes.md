# Persona 1: entrega y pendientes externos

Rama: `codex/persona-1-verificacion-final`.
Worktree: `C:\Users\ambar\TrazFlow-G8-persona-1`.
Ver [resultado completo](persona-1-calidad.md) y [evidencias de infraestructura](trz118-https-estado.md).

## Trabajo implementado

| Ticket | Resultado |
| --- | --- |
| TRZ-122 | Todo el código de tests usa Vitest; una cobertura V8; una config Playwright con siete proyectos; scripts y guía actualizados. |
| TRZ-119 | Workflow CI sin secretos: instalación, lint, tipos, tests y build. Node 24 compatible con las dependencias reales; badge y archivos generados ignorados. Protección de ramas requiere Cata. |
| TRZ-114 | Contrato compartido ejecutado contra mock, ERPNext y Odoo; omisiones explícitas para operaciones no soportadas. Mock exige despacho previo y permite reintento. |
| TRZ-117 | Reglas de importación y acciones probadas; filas inválidas no se escriben; rows.ts con cobertura 100%; SQL local con rollback. |
| TRZ-120 | Textos y comentarios neutrales fuera del adaptador; regla CODE documentada como propia de TrazFlow. |
| TRZ-32 | Filtros combinados de estado/distribuidora en servidor, URL persistida, limpieza y estado vacío; mantiene aislamiento por empresa. |
| TRZ-118 | IP reservada, HTTPS válido, firewall persistido, 8080 cerrado, credenciales renovadas, arranque automático corregido y verificado con reinicio. Cata confirmó Vercel. |
| TRZ-73 | Guía del registro, empresa/rol, solicitud, aprobación/rechazo, revocación y asignación de choferes según el modelo vigente. |
| TRZ-124 | README con app pública verificada, captura, roles, equipo confirmado, arquitectura y enlaces. Docs de ubicación, ERP e infraestructura actualizadas. Revisión final depende de merges restantes. |

El PR de pallets #87 de Nai se integró desde develop: lecturas por `pallet_contents`,
pallets mixtos y reingreso. Los fixtures E2E se adaptaron al contenido compartido y
al snapshot `expected_items` de cada orden, sin volver al formato escalar antiguo.

## TRZ-119: acción de Cata en GitHub

La conexión de GitHub no tiene administración. Consultar protección de main y
develop respondió 403, por lo que no se afirma que esté activada o desactivada.
El YAML no configura protección por sí mismo.

Cata debe configurar ambas ramas para exigir PR y el check `CI`, y comprobar que
un PR rojo queda bloqueado y que uno verde puede aprobarse. La ejecución del
workflow y la revisión de las reglas son verificaciones diferentes.

Mensaje listo para enviar:

> Cata, el workflow CI de persona 1 ya corre lint, tipos, todos los tests y build.
> Para cerrar TRZ-119 falta que, como administradora, configures main y develop
> para exigir PR y el check CI. Mi conexión no tiene permisos de administración
> (devuelve 403). Verificá también que un PR con CI rojo no pueda mergearse.

## TRZ-73 / TRZ-124: dependencias del cierre de sprint

La documentación refleja el código integrado; las siguientes funciones todavía
no están en develop y pertenecen a otras personas:

- Cata: TRZ-112 alta de empresa/ERP por empresa, TRZ-74 reenvío y TRZ-31 recuperación.
- Jowi: TRZ-116 alta de depósitos y TRZ-115 layouts configurables.
- Guille: TRZ-125 diagrama ERP nivel 3 (fuente e imagen) y capacidades si se integran.
- Nai con adaptadores/outbox: reporte ERP de todos los ítems del pallet mixto.

Después de esos merges, actualizar las secciones afectadas y hacer la revisión
cruzada con otra persona que pide TRZ-124. La revisión de una sola persona no
sustituye ese criterio. El README ya incluye la URL pública y los siete nombres;
las cuentas del seed son locales, no credenciales de producción.

## Infraestructura

No falta otro reinicio: la prueba final y la corrección de arranque automático
están registradas en [TRZ-118](trz118-https-estado.md). Vercel fue confirmado por
Cata; la prueba independiente cubrió la VM y lecturas con ErpNextClient por HTTPS.
El archivo temporal de entrega de credenciales se retiró. Odoo requerirá su
propio dominio/proxy al desplegarse; no hay despliegue Odoo confirmado.

## Cómo continuar al recibir los merges

Hacer fetch, integrar origin/develop en esta rama, revisar la documentación de las
funciones nuevas y repetir lint, typecheck, test:coverage y build, además de las
suites afectadas. No ejecutar build en paralelo con Playwright: Next limpia .next,
que contiene los directorios de las suites. No usar credenciales cloud ni seeds
locales contra la base compartida.
