import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiBaseUrl } from './api';

let socket: Socket | null = null;
// Phase 15 (Low-Network / Resilience Mode) — same rationale as apps/web/lib/realtime.ts's own
// joinedSalonIds: Socket.IO auto-reconnects the transport, but the server's room membership for
// that connection doesn't survive a drop, so a client on flaky mobile data would otherwise stop
// receiving queue.updated/etc. for a salon it's still viewing until the screen remounts.
const joinedSalonIds = new Set<string>();

/**
 * A single shared socket for the app's lifetime, connected lazily on first use. `auth` is a
 * callback (not a static object) so every reconnect attempt picks up the current in-memory
 * access token rather than one captured at connect time — the token rotates roughly every 15
 * minutes. `transports: ['websocket']` skips Engine.IO's HTTP long-polling fallback, which is
 * unnecessary overhead on React Native and occasionally flaky under Metro's dev proxy.
 */
export function getRealtimeSocket(): Socket {
  if (!socket) {
    const origin = new URL(getApiBaseUrl()).origin;
    socket = io(`${origin}/realtime`, {
      autoConnect: false,
      reconnection: true,
      transports: ['websocket'],
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    // Fires on the initial connect AND every reconnect — re-joining is idempotent server-side.
    socket.on('connect', () => {
      for (const salonId of joinedSalonIds) socket!.emit('join:salon', { salonId });
    });
  }
  if (!socket.connected) socket.connect();
  return socket;
}

/** Joins `salon:{salonId}` — required to receive `queue.updated`/`staff.status.changed` for that
 * salon; `customer:{userId}` is joined automatically by the gateway on connect. */
export function joinSalonRoom(salonId: string): void {
  joinedSalonIds.add(salonId);
  getRealtimeSocket().emit('join:salon', { salonId });
}

/** Runs `callback` after every successful RECONNECT (not the initial connect) — see
 * apps/web/lib/realtime.ts's own onReconnect for the full rationale (missed events while
 * disconnected are never replayed by the backend, so a stale view needs an explicit refetch). */
export function onReconnect(callback: () => void): () => void {
  const s = getRealtimeSocket();
  s.io.on('reconnect', callback);
  return () => {
    s.io.off('reconnect', callback);
  };
}
