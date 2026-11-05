import { Role, SessionAudience, type AssistantSurface, type AssistantTurnDto } from '@barbercue/shared';

/** The UI deliberately never retains the bearer-like, short-lived write confirmation token. */
export type AssistantDisplayTurn = Omit<AssistantTurnDto, 'confirmation'>;

export interface PendingAssistantConfirmation {
  token: string;
  expiresAt: string;
  surface: AssistantSurface;
  salonId: string | null;
  requiresAcknowledgement: boolean;
}

export function assistantConfirmationCanProceed(
  pending: PendingAssistantConfirmation,
  acknowledged: boolean,
): boolean {
  return !pending.requiresAcknowledgement || acknowledged;
}

export function pendingAssistantConfirmation(
  turn: AssistantTurnDto,
  writesEnabled: boolean,
  surface: AssistantSurface,
  salonId: string | null,
): PendingAssistantConfirmation | null {
  const confirmation = turn.confirmation;
  if (!writesEnabled || turn.status !== 'NEEDS_CONFIRMATION' || turn.action?.kind !== 'WRITE') return null;
  if (!confirmation?.token || !Number.isFinite(Date.parse(confirmation.expiresAt))) return null;
  return {
    token: confirmation.token,
    expiresAt: confirmation.expiresAt,
    surface,
    salonId,
    requiresAcknowledgement: turn.preview?.risk === 'high',
  };
}

export function assistantConfirmationReadiness(
  pending: PendingAssistantConfirmation,
  context: { surface: AssistantSurface; salonId: string | null; now?: number },
): 'ready' | 'expired' | 'context-changed' {
  if (Date.parse(pending.expiresAt) <= (context.now ?? Date.now())) return 'expired';
  if (pending.surface !== context.surface) return 'context-changed';
  if (context.surface === 'shop' && pending.salonId !== context.salonId) return 'context-changed';
  return 'ready';
}

export function toAssistantDisplayTurn(turn: AssistantTurnDto, confirmedWrite = false): AssistantDisplayTurn {
  if (turn.action?.kind === 'WRITE' && turn.status === 'DONE' && !confirmedWrite) {
    return {
      requestId: turn.requestId,
      status: 'FAILED',
      action: turn.action,
      message: 'This mobile client cannot confirm changes. No change was reported as completed.',
      completedAt: turn.completedAt,
    };
  }

  const { confirmation: _confirmation, ...displayTurn } = turn;
  return displayTurn;
}

export function assistantSurfaceForUser(user: {
  audience: string;
  roles: readonly string[];
}): AssistantSurface | null {
  // The iOS navigator currently has Customer, Owner, and Shop Staff shells only. Do not expose
  // the employee Assistant surface until a matching iOS employee destination exists.
  if (user.audience === SessionAudience.CUSTOMER && user.roles.length === 1 && user.roles[0] === Role.CUSTOMER) {
    return 'customer';
  }
  if (
    user.audience === SessionAudience.STAFF &&
    user.roles.length > 0 &&
    user.roles.every((role) => role === Role.SALON_OWNER || role === Role.SALON_STAFF)
  ) {
    return 'shop';
  }
  return null;
}
