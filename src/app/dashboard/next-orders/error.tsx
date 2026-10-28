"use client";
export default function NextOrdersError({ retry }: { retry: () => void }) {
  return <div className="app-page"><div className="surface space-y-3 p-6" role="alert">
    <h2 className="text-lg font-semibold">No se pudieron calcular los próximos pedidos</h2>
    <p>Revisá tu conexión e intentá nuevamente.</p>
    <button type="button" className="button-primary" onClick={retry}>Reintentar</button>
  </div></div>;
}
