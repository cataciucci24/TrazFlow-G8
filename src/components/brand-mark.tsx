type BrandMarkProps = { className?: string };
type BrandLogoProps = { className?: string; inverse?: boolean };

/** Ícono de caja de depósito usado como identificador visual de TrazFlow. */
export function BrandMark({ className = "size-8" }: BrandMarkProps) {
  return (
    <span className={`grid ${className} place-items-center rounded-[10px] bg-[var(--brand)] text-white`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%] fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.5 7.5 8.5-4 8.5 4-8.5 4-8.5-4Z" />
        <path d="M3.5 7.5v9l8.5 4 8.5-4v-9M12 11.5v9" />
        <path d="m7.5 5.6 8.5 4" />
      </svg>
    </span>
  );
}

/** Identidad completa de TrazFlow, reutilizada en accesos y navegación. */
export function BrandLogo({ className = "", inverse = false }: BrandLogoProps) {
  return (
    <span className={`inline-flex min-h-11 items-center gap-3 ${className}`}>
      <BrandMark className="size-8" />
      <span className={`text-lg font-bold tracking-tight ${inverse ? "text-white" : "text-stone-900"}`}>TrazFlow</span>
    </span>
  );
}
