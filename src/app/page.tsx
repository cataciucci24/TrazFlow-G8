// La redirección real ("/" -> /dashboard o /login) la resuelve el proxy
// (src/proxy.ts) antes de llegar a renderizar. Esto es solo un fallback.
export default function Home() {
  return null;
}
