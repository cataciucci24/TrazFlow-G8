"use client";
import { useEffect, useRef, useState } from "react";

export function activeSectionFromPositions(sections: { id: string; top: number }[], stickyBottom: number, atBottom: boolean) {
  if (atBottom) return sections[sections.length - 1].id;
  let active = sections[0].id;
  for (const section of sections) if (section.top <= stickyBottom + 4) active = section.id;
  return active;
}

export function LocationsNavigation({ canGenerate, canMove }: { canGenerate: boolean; canMove: boolean }) {
  const sections = [{ id: "crear-ubicacion", label: "Crear ubicación" }, ...(canGenerate ? [{ id: "generar-ubicaciones", label: "Generar ubicaciones" }] : []), { id: "consultar-pallet", label: canMove ? "Asignar o cambiar ubicación" : "Consultar pallet" }, { id: "ubicaciones-disponibles", label: "Ubicaciones disponibles" }];
  const [active, setActive] = useState(sections[0].id);
  const nav = useRef<HTMLElement>(null);
  const automatic = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const ids = ["crear-ubicacion", ...(canGenerate ? ["generar-ubicaciones"] : []), "consultar-pallet", "ubicaciones-disponibles"];
    function releaseAfterScroll() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { automatic.current = false; timer.current = null; }, 200);
    }
    function update() {
      if (automatic.current) { releaseAfterScroll(); return; }
      const positions = ids.flatMap((id) => { const element = document.getElementById(id); return element ? [{ id, top: element.getBoundingClientRect().top }] : []; });
      if (!positions.length) return;
      const panel = document.getElementById("main-content")?.parentElement;
      const desktop = window.innerWidth >= 1024 && panel;
      const scrollable = desktop ? panel.scrollHeight - panel.clientHeight : document.documentElement.scrollHeight - window.innerHeight;
      const position = desktop ? panel.scrollTop : window.scrollY;
      const atBottom = scrollable > 2 && scrollable - position < 2;
      setActive(activeSectionFromPositions(positions, nav.current?.getBoundingClientRect().bottom ?? 0, atBottom));
    }
    function interrupt() { automatic.current = false; if (timer.current) clearTimeout(timer.current); timer.current = null; }
    function keydown(event: KeyboardEvent) { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) interrupt(); }
    window.addEventListener("scroll", update, { passive: true, capture: true });
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("pointerdown", interrupt);
    window.addEventListener("keydown", keydown);
    update();
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("wheel", interrupt); window.removeEventListener("touchstart", interrupt); window.removeEventListener("pointerdown", interrupt); window.removeEventListener("keydown", keydown); if (timer.current) clearTimeout(timer.current); };
  }, [canGenerate]);

  function navigate(id: string) {
    if (timer.current) clearTimeout(timer.current);
    automatic.current = true;
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    timer.current = setTimeout(() => { automatic.current = false; timer.current = null; }, 200);
  }
  return <nav ref={nav} aria-label="Secciones de ubicaciones" className="sticky top-[76px] z-20 -mx-2 overflow-x-auto bg-[var(--surface)] px-2 py-2 lg:top-0"><div className="flex w-max min-w-full gap-2">{sections.map((section) => <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined} onClick={(event) => { event.preventDefault(); navigate(section.id); }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active === section.id ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>{section.label}</a>)}</div></nav>;
}
