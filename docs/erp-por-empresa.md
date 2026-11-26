# ERP por empresa (TRZ-112, parte 1/2)

Cada empresa configura su propio ERP desde la app. La sincronización, el outbox y los cron usan el ERP de la empresa
que corresponde: dos empresas con ERPs distintos no se cruzan datos ni envíos. La parte 2 (alta de empresa desde
la app) está en [onboarding](onboarding.md#1-dar-de-alta-la-empresa-trz-112): una empresa nueva arranca sin ERP.

Migración: `supabase/migrations/20261124100000_trz112_company_erp.sql`. Prueba con dos empresas:
`supabase/tests/trz112_company_erp_isolation.sql`.

## Cómo se configura

**Integración ERP → pestaña Configuración** (solo `logistics_manager`): proveedor (ERPNext, Odoo, sin ERP y, fuera de
producción, ERP simulado), URL, credenciales, base y usuario de Odoo, Item Group y tiempo de espera. **Probar
conexión** usa lo que está en el formulario sin guardarlo.

- Los datos sin secretos van en `erp_company_settings` (la tabla de TRZ-65). De las credenciales se guardan solo las
  últimas 4 letras para mostrarlas enmascaradas.
- Las credenciales van cifradas en **Supabase Vault**. `erp_company_credentials` guarda solo el id del secreto y no
  tiene permisos para nadie: la escribe `erp_save_company_config` y la lee `erp_company_connection` (solo
  `service_role`). Nunca vuelven al navegador.
- Si las credenciales quedan vacías se conservan las guardadas, **pero solo si no cambian el proveedor ni la URL**.
  Así nadie puede apuntar la URL a otro servidor para que TrazFlow le mande la credencial guardada.
- Sin proveedor (`erp_provider` null), la empresa trabaja en modo manual, como antes sin `ERP_PROVIDER`.

### Transición de TrazFlow Demo

Las variables `ERP_*` de Vercel siguen funcionando **solo** para la empresa de `ERP_ENV_COMPANY_ID`, y solo mientras
esa empresa no tenga una configuración guardada (la guardada gana). Pasos para el deploy:

1. Aplicar la migración.
2. En Vercel, agregar `ERP_ENV_COMPANY_ID` con el id de TrazFlow Demo. Así sigue con su ERPNext sin cortes.
3. Cuando logística guarde el ERP de Demo en el panel, borrar `ERP_ENV_COMPANY_ID` y las `ERP_*` de conexión.

`SUPABASE_SERVICE_ROLE_KEY` es obligatoria en todos los entornos para las empresas configuradas desde el panel.

## Interfaz para el resto del equipo

### Contexto ERP de una empresa

```ts
import { getCompanyErpContext, getErpClient } from "@/lib/erp";

const erp = await getCompanyErpContext(companyId); // { companyId, provider, source, client } | null (sin ERP)
const client = await getErpClient(companyId);      // ErpClient; ErpError("config") si la empresa no tiene ERP
```

- `companyId` sale **siempre** del perfil de la sesión (`requireUserProfile().companyId`) o de la columna
  `company_id` del evento. Nunca de un dato que mande el usuario.
- `isErpEnabled(companyId)` (`src/lib/erp-sync/enabled.ts`) decide si la empresa trabaja con ERP. Es lo que usan las
  pantallas para ocultar el alta manual; no hace falta cambiar nada en quien ya lo usa.
- La resolución vive en `src/lib/erp/company.ts` y la fábrica de adaptadores en `src/lib/erp/factory.ts`. El mock
  tiene una instancia por empresa.

### Outbox

- La clave de idempotencia es única **por empresa** (`unique (company_id, idempotency_key)`). Antes era global: con
  `on conflict do nothing`, el reporte de una segunda empresa con el mismo número de orden se descartaba sin avisar.
- `erp_outbox_claim(p_limit, p_aggregate_id, p_company_id)` devuelve también `company_id`. Con sesión siempre es la
  empresa del usuario (otra → `42501`). El cron (`service_role`) pasa la empresa.
- `processErpOutbox({ getClient: (companyId) => ..., companyId? })` pide el cliente por la empresa de cada evento,
  una vez por empresa y por corrida. Los reintentos del panel salen por el ERP de la empresa del evento.
- El cron del outbox (`/api/cron/erp-outbox`) lista las empresas con vencidos (`erp_outbox_due_companies`) y las
  procesa de a una. Un ERP caído no frena a las demás. El cron de sincronización saltea las empresas sin ERP.

### Dónde se construyen y encolan los reportes (para persona 3)

Ningún productor cambió en TRZ-112: siguen en `contractVersion: 1`.

| Reporte | Se arma en | Se encola en |
| --- | --- | --- |
| Despacho (`dispatch:{orden}`) | `erp_outbox_dispatch_payload` (última versión: `20261028100200_trz100_order_lines.sql`) | `confirm_dispatch_order` (última versión: `20261122110100_pallet_item_checks.sql`) |
| Entrega (`delivery:{orden}`) | `erp_outbox_delivery_payload` (`20261028130000_trz103_delivery_receipts.sql`) | trigger `enqueue_erp_delivery_report` (misma migración) |
| Remito firmado (`delivery-receipt:…`) | dentro de `register_delivery_receipt` (`20261028130000`) | ídem |
| Scan / unscan (`pallet-scan:…` / `pallet-unscan:…`) | `erp_pallet_scan_event` (`20261031100000_trz62_63_erp_stock_movements.sql`) | trigger `enqueue_erp_pallet_scan` (misma migración) |

Para la versión 2 (una línea por ítem; ver `docs/erp-contract-mixtos.md`):

- En una migración nueva, `create or replace` de esas funciones, con `contractVersion: 2` y los ítems de
  `order_pallets.expected_items` (la copia histórica de la orden).
- Cada `insert` en `erp_outbox_events` lleva el `company_id` de la orden. Los formatos de clave no cambian.
- No tocar `erp_outbox_claim`, `mark_*`, la constraint de unicidad ni el procesador: el ruteo por empresa ya está.
- Los eventos v1 que ya están en el outbox se procesan tal cual.
- La protección TM111 (`trg_guard_mixed_erp_order` y la rama ERP de `guard_dispatch_content`) se retira recién
  después de la prueba conjunta.
