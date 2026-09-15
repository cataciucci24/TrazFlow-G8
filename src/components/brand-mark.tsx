type BrandMarkProps = { className?: string };

/** Ícono de caja de depósito usado como identificador visual de TrazFlow. */
export function BrandMark({ className = "size-8" }: BrandMarkProps) {
  return (
    <span className={`grid ${className} place-items-center rounded-lg bg-amber-500 text-white`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3.5 7.5 8.5-4 8.5 4-8.5 4-8.5-4Z" />
        <path d="M3.5 7.5v9l8.5 4 8.5-4v-9M12 11.5v9" />
        <path d="m7.5 5.6 8.5 4" />
      </svg>
    </span>
  );
}
