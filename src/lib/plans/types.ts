export type SubscriptionPlan = {
  code: string;
  name: string;
  monthlyPriceCents: number | null;
  currency: string;
  maxOperators: number | null;
  maxPalletsPerMonth: number | null;
  printerCount: number | null;
  printerModel: string;
  equipmentPriceCents: number | null;
  preliminary: boolean;
};

export type CompanyPlanResult = {
  available: boolean;
  plan: SubscriptionPlan | null;
};

const COUNT_FORMATTER = new Intl.NumberFormat("es-AR");

export function formatPlanPrice(cents: number | null, currency = "USD"): string {
  if (cents === null) return "A medida";
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function operatorLimitLabel(limit: number | null): string {
  return limit === null ? "Operadores ilimitados" : `Hasta ${COUNT_FORMATTER.format(limit)} operadores`;
}

export function palletLimitLabel(limit: number | null): string {
  return limit === null ? "Pallets sin límite mensual" : `Hasta ${COUNT_FORMATTER.format(limit)} pallets por mes`;
}
