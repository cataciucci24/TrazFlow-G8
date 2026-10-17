# TrazFlow

Logistics traceability and visibility platform.

## Current operation

TrazFlow complements the ERP by recording the physical flow of pallets. The visible roles are logistics manager, warehouse operator and driver. Drivers receive assignments per dispatch order and confirm deliveries from **Mis entregas**. Recipients remain business data and do not need accounts.

Pallet labels can be printed individually or in batches from the pallet list. The browser produces an A4 sheet and encodes the persisted pallet code without allowing manual edits.

Database changes are applied with the Supabase migrations. Existing `distributor_operator` users must be transitioned explicitly by following [`docs/transicion-choferes.md`](docs/transicion-choferes.md).

## ERP integration

The ERP is the source of truth for products, lots, stock and orders. The app talks to it only through the `ErpClient` interface in `src/lib/erp` (`getErpClient(companyId)`), and the provider is chosen with server-only environment variables:

```bash
ERP_PROVIDER=mock            # default; or "erpnext"
ERP_MOCK_SCENARIO=ok         # mock only: ok | timeout | unauthorized | validation | server_error
ERP_BASE_URL=http://localhost:8080   # erpnext only
ERP_API_KEY=...                      # erpnext only
ERP_API_SECRET=...                   # erpnext only
ERP_TIMEOUT_MS=10000                 # optional
```

The contract (payloads, external ids, error codes, idempotency key and ERPNext setup) is documented in [`docs/erp-contract.md`](docs/erp-contract.md).

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
