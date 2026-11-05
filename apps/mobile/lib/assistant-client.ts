import { Role, SessionAudience, type AssistantSurface, type AssistantTurnDto } from '@barbercue/shared';

/** The UI deliberately never retains the bearer-like, short-lived write confirmation token. */
export type AssistantDisplayTurn = Omit<AssistantTurnDto, 'confirmation'>;

export function toAssistantDisplayTurn(turn: AssistantTurnDto): AssistantDisplayTurn {
  if (turn.action?.kind === 'WRITE' && turn.status === 'DONE') {
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
  if (user.audience === SessionAudience.EMPLOYEE && user.roles.length === 1 && user.roles[0] === Role.FIELD_EXECUTIVE) {
    return 'employee';
  }
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
