# Odoo local (TRZ-113)

> Odoo 19.0 Community en Docker, para probar el segundo adaptador ERP (`ERP_PROVIDER=odoo`, solo lectura) sin
> tocar ERPNext. No hay un Odoo deployado: esto es solo para desarrollo y para la demo en una máquina local. Contrato
> y mapeo: [`erp-contract.md`](erp-contract.md) §10.
>
> **Nunca** van al repo las API keys de Odoo ni contraseñas que no sean las de este entorno local. Van en
> `.env.local` (ignorado por git).

## 1. Requisitos

- Docker Desktop (en Windows, con la integración de WSL activada) y Node 20+ (el seed usa el `fetch` de Node).
- Puerto `8069` libre.

## 2. Levantar Odoo

Archivos: [`infra/odoo/docker-compose.yml`](../infra/odoo/docker-compose.yml) (imagen oficial `odoo:19.0` y
`postgres:16`, con volúmenes `odoo-db` y `odoo-data`).

La primera vez, crear la base `trazflow` con los módulos instalados (tarda ~1 minuto):

```bash
docker compose -f infra/odoo/docker-compose.yml run --rm odoo \
  odoo -d trazflow -i stock,product_expiry --stop-after-init
docker compose -f infra/odoo/docker-compose.yml up -d
```

Odoo queda en `http://localhost:8069`, con usuario `admin` y contraseña `admin` (cambiarla si la máquina es
accesible desde afuera). Odoo 19 no carga datos de demostración por defecto.

Para apagarlo: `docker compose -f infra/odoo/docker-compose.yml down` (con `-v` borra también la base).

## 3. Módulos y opciones

| En la interfaz | Técnico | Cómo se activa |
|---|---|---|
| Inventario | módulo `stock` | `-i stock` del paso 2 (o el seed, si falta) |
| Fechas de vencimiento | módulo `product_expiry` | `-i product_expiry` del paso 2 (o el seed, si falta) |
| Lotes y números de serie | opción `group_stock_production_lot` de Inventario → Configuración → Ajustes | El seed la activa |

Sin Fechas de vencimiento el adaptador funciona igual, pero los lotes llegan con `expirationDate: null`.

## 4. Datos de prueba

```bash
ODOO_URL=http://localhost:8069 ODOO_DB=trazflow ODOO_USER=admin ODOO_PASSWORD=admin node scripts/odoo-seed.mjs
# Odoo listo: 2 depósitos, 5 productos, 11 lotes, 14 saldos ajustados.
```

[`scripts/odoo-seed.mjs`](../scripts/odoo-seed.mjs) es idempotente: busca cada registro por su clave y fija
cantidades absolutas con ajustes de inventario, así que correrlo de nuevo responde "0 saldos ajustados". Deja:

- **Depósitos:** "Depósito Central" (el `WH` que crea Odoo, renombrado) y "Depósito Norte" (`NOR`).
- **Productos** (almacenables, con seguimiento por lote y fecha de vencimiento): `ACE-500`, `ARR-1KG`, `YER-500`,
  `LEC-1L` en "Units" y `QUE-CREM` en "kg". Son las únicas dos unidades que hoy traduce la sincronización.
- **Lotes:** 2–3 por producto con vencimiento, y stock en uno o los dos depósitos.

## 5. API key

Odoo no deja generar API keys por la API. En la interfaz: avatar → **Mis preferencias → Seguridad de la cuenta →
Nueva clave de API**, con una descripción ("TrazFlow") y duración. Se muestra una sola vez.

En local también se puede usar la contraseña del usuario como `ERP_API_KEY` (Odoo acepta las dos en la API externa).
Para algo compartido, conviene un usuario propio con permisos de solo lectura sobre Inventario y su API key.

## 6. Variables

En `.env.local` de TrazFlow:

| Variable | Valor local |
|---|---|
| `ERP_PROVIDER` | `odoo` |
| `ERP_BASE_URL` | `http://localhost:8069` |
| `ERP_ODOO_DB` | `trazflow` |
| `ERP_ODOO_USER` | `admin` (o el login del usuario de la API key) |
| `ERP_API_KEY` | la API key del paso 5 (en local puede ser `admin`) |
| `ERP_TIMEOUT_MS` | opcional, `10000` |

**Solo servidor**: nunca con prefijo `NEXT_PUBLIC_`. Con `ERP_PROVIDER=odoo` la sincronización trae depósitos,
productos, lotes y stock; las órdenes de despacho y los reportes no están soportados (fallan con `config`).

## 7. Verificación

Resultado al 21/11/2026, corriendo `OdooClient` contra este Odoo (19.0-20261112) con el seed:
`healthcheck` ok; `pullMasterData` con 2 depósitos, 5 productos, 11 lotes y 14 saldos (por producto + lote +
depósito); con `updatedSince` en el futuro, 0 productos y 0 lotes pero depósitos y stock completos. API key mala y
base inexistente → `unauthorized`; puerto cerrado → `network`; timeout → `timeout`.

## Pendientes conocidos

- **API deprecada:** `/jsonrpc` funciona en Odoo 19 y 20, pero se elimina en Odoo 22 (fines de 2028) y Online 21.1.
  Migrar a la API JSON-2 antes de esa versión.
- **Sin deploy:** no hay un Odoo accesible desde Vercel. Para la demo en la nube haría falta una VM como la de
  ERPNext ([`erpnext-deploy.md`](erpnext-deploy.md)).
- **Solo lectura:** órdenes, reportes de despacho y entrega, movimientos de stock e importación quedan fuera de
  TRZ-113.
