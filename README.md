# TrazFlow

Logistics traceability and visibility platform.

## Current operation

TrazFlow complements the ERP by recording the physical flow of pallets. The visible roles are logistics manager, warehouse operator and driver. Drivers receive assignments per dispatch order and confirm deliveries from **Mis entregas**. Recipients remain business data and do not need accounts.

Pallet labels can be printed individually or in batches from the pallet list. The browser produces an A4 sheet and encodes the persisted pallet code without allowing manual edits.

Database changes are applied with the Supabase migrations. Existing `distributor_operator` users must be transitioned explicitly by following [`docs/transicion-choferes.md`](docs/transicion-choferes.md).

## ERP integration

The ERP is the source of truth for products, lots, stock and orders. The app talks to it only through the `ErpClient` interface in `src/lib/erp` (`getErpClient(companyId)`), and the provider is chosen with server-only environment variables:

```bash
ERP_PROVIDER=mock            # unset = company works without ERP; "mock" or "erpnext" enables the sync
ERP_MOCK_SCENARIO=ok         # mock only: ok | timeout | unauthorized | validation | server_error
ERP_BASE_URL=http://localhost:8080   # erpnext only
ERP_API_KEY=...                      # erpnext only
ERP_API_SECRET=...                   # erpnext only
ERP_TIMEOUT_MS=10000                 # optional
```

The contract (payloads, external ids, error codes, idempotency key and ERPNext setup) is documented in [`docs/erp-contract.md`](docs/erp-contract.md).

### Syncing master data and orders (US-ERP-03)

`ERP_PROVIDER` must be set **explicitly** for the integration to be on (`isErpEnabled` in `src/lib/erp-sync/enabled.ts`). `getErpClient` still falls back to the mock, but an unset variable means "this installation has no ERP": the manual product/lot/pallet forms keep working and the sync action answers with a clear message. Copy [`.env.example`](.env.example) to `.env.local` and set `ERP_PROVIDER=mock` to try the flow:

1. Apply the migrations (`npx supabase db reset` on a local database).
2. Sign in as a logistics manager and open **Pallets**. Under *Integración ERP*, link the ERP warehouse `Depósito Central - SRV` (the mock's warehouse) to `DEP-01`.
3. Press **Sincronizar con ERP** (also available in **Órdenes**). The panel shows the result and every run is audited in `erp_sync_runs`. Use `ERP_MOCK_SCENARIO=timeout` (or another scenario) to see a failed run: the app stays usable and the error is shown and stored.

What gets imported: products, lots, one pallet per stock balance (lot × warehouse) and the header of open dispatch orders, which arrive as drafts. Order lines are not imported yet. Upserts always use `(company_id, external_id)`. Nothing is deleted when it stops coming from the ERP, and a re-sync never overwrites local progress. With the ERP enabled, the manual create forms are hidden and ERP-owned fields cannot be edited through the API.

> **An imported pallet is an ERP stock balance, not a verified physical pallet.** TrazFlow generates its QR code. Print the label only when the pallet is physically prepared (US-OPS-08).

Details, counters and limitations: [`docs/erp-sync.md`](docs/erp-sync.md).

### Integration panel (US-ERP-05)

Logistics managers get **Integración ERP** (`/dashboard/integrations`): ERP connection status (healthcheck), last sync, dispatched orders not yet reported to the ERP, and a filterable, paginated history of syncs and dispatch reports with sanitized error details. From there they can sync, retry a failed dispatch report (same payload, audited, sent right away) and send due pending reports. `ERP_SYNC_STALE_AFTER_HOURS` (server-only, default 24) sets when the last successful sync is shown as outdated. Badges, permissions, known risks and a manual test checklist: [`docs/erp-integration-panel.md`](docs/erp-integration-panel.md).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
