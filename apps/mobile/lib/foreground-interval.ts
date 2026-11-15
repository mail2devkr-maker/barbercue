import { AppState, type AppStateStatus } from 'react-native';

/**
 * Neon compute cost (owner report 15 Nov 2026): the database never slept, partly because screens
 * kept polling the API from phones where the app sat in the background. This interval ticks only
 * while the app is in the foreground; when it comes back it runs once immediately (fresh data) and
 * resumes. Push notifications and the protected arrival-alert path are not affected.
 * Returns a cleanup function.
 */
export function setForegroundInterval(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = null;
  const start = () => {
    if (id === null) id = setInterval(fn, ms);
  };
  const stop = () => {
    if (id !== null) clearInterval(id);
    id = null;
  };
  const onChange = (next: AppStateStatus) => {
    if (next === 'active') {
      if (id === null) {
        fn();
        start();
      }
    } else {
      stop();
    }
  };
  if (AppState.currentState === 'active' || AppState.currentState == null) start();
  const sub = AppState.addEventListener('change', onChange);
  return () => {
    stop();
    sub.remove();
  };
}
