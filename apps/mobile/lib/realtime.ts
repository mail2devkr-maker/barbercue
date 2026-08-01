import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getApiBaseUrl } from './api';

let socket: Socket | null = null;

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
  }
  if (!socket.connected) socket.connect();
  return socket;
}

/** Joins `salon:{salonId}` — required to receive `queue.updated`/`staff.status.changed` for that
 * salon; `customer:{userId}` is joined automatically by the gateway on connect. */
export function joinSalonRoom(salonId: string): void {
  getRealtimeSocket().emit('join:salon', { salonId });
}
