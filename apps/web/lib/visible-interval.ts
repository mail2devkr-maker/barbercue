/**
 * Neon compute cost (owner report 15 Nov 2026): owner and staff screens left open in a background
 * browser tab kept polling the API all night, so the database never slept. This interval only
 * ticks while the page is visible; when the tab becomes visible again it runs once immediately
 * (fresh data at once) and resumes. Realtime socket events keep working while hidden - only the
 * timed safety polls pause. Outside a browser it behaves like a plain setInterval.
 * Returns a cleanup function.
 */
export function setVisibleInterval(fn: () => void, ms: number): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
  let id: number | null = null;
  const start = () => {
    if (id === null) id = window.setInterval(fn, ms);
  };
  const stop = () => {
    if (id !== null) window.clearInterval(id);
    id = null;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      stop();
    } else if (id === null) {
      fn();
      start();
    }
  };
  if (document.visibilityState !== "hidden") start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
