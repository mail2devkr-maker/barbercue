import type { AuthenticatedUser } from '@barbercue/shared';

/**
 * Who may use the FastQue Action Assistant (issue #362 release gate). FAIL CLOSED: anything other than
 * an exact recognised value means OFF, so a missing, misspelt or empty variable hides the assistant.
 *
 *   ASSISTANT_MODE            off (default) | cohort | all
 *   ASSISTANT_COHORT_USER_IDS comma-separated user UUIDs (the allowlisted test cohort)
 *   ASSISTANT_WRITES          off (default) | cohort | all
 *   ASSISTANT_WRITE_SALON_IDS comma-separated shop UUIDs where Assistant edits are allowed (issue #372)
 *   ASSISTANT_WRITE_ACTIONS   comma-separated action ids that may be edited, e.g. chairs.setStatus
 *
 * Issue #372: ASSISTANT_WRITES alone no longer opens any edit. A write also needs its SHOP and its
 * ACTION on the two allowlists above; both are EMPTY by default (deny everything). The literal "*"
 * means any, and exists for disposable test databases only. A self-service write with no shop
 * (a customer's own booking) needs only its action on the list.
 *
 * Writes are a separate switch and never exceed who can use the assistant at all: with MODE=cohort,
 * WRITES=all still only lets the cohort write. Every assistant route answers 404 for anyone the
 * assistant is not enabled for, and every write (preview and confirmation) is refused while writes are
 * off for that user. Role and shop permission checks still apply on top of this gate.
 */
export const ASSISTANT_ROLLOUT = Symbol('ASSISTANT_ROLLOUT');

type Level = 'off' | 'cohort' | 'all';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function level(raw: string | undefined): Level {
  const v = (raw ?? '').trim();
  return v === 'all' || v === 'cohort' ? v : 'off';
}

export class AssistantRollout {
  readonly mode: Level;
  readonly writes: Level;
  private readonly cohort: ReadonlySet<string>;
  private readonly writeSalons: ReadonlySet<string> | '*';
  private readonly writeActions: ReadonlySet<string> | '*';

  constructor(env: Record<string, string | undefined>) {
    this.mode = level(env.ASSISTANT_MODE);
    this.writes = level(env.ASSISTANT_WRITES);
    this.cohort = new Set(
      (env.ASSISTANT_COHORT_USER_IDS ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => UUID.test(s)),
    );
    const list = (raw: string | undefined, valid: (s: string) => boolean) => {
      const items = (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length === 1 && items[0] === '*') return '*' as const;
      return new Set(items.filter(valid).map((s) => s.toLowerCase()));
    };
    this.writeSalons = list(env.ASSISTANT_WRITE_SALON_IDS, (s) => UUID.test(s));
    this.writeActions = list(env.ASSISTANT_WRITE_ACTIONS, (s) =>
      /^[a-z]+\.[a-zA-Z]+$/.test(s),
    );
  }

  private allows(l: Level, user: Pick<AuthenticatedUser, 'id'>): boolean {
    return (
      l === 'all' || (l === 'cohort' && this.cohort.has(user.id.toLowerCase()))
    );
  }

  enabledFor(user: Pick<AuthenticatedUser, 'id'>): boolean {
    return this.allows(this.mode, user);
  }

  writesFor(user: Pick<AuthenticatedUser, 'id'>): boolean {
    return this.enabledFor(user) && this.allows(this.writes, user);
  }

  /**
   * Issue #372: may THIS user preview/confirm THIS write action in THIS shop? Checked at preview
   * and again at confirmation. Default deny.
   */
  writeAllowed(
    user: Pick<AuthenticatedUser, 'id'>,
    actionId: string,
    salonId: string | null,
  ): boolean {
    if (!this.writesFor(user)) return false;
    const action =
      this.writeActions === '*' ||
      this.writeActions.has(actionId.toLowerCase());
    const salon = !salonId
      ? true
      : this.writeSalons === '*' || this.writeSalons.has(salonId.toLowerCase());
    return action && salon;
  }

  /** A log-safe description: counts only, never the user ids. */
  describe(): string {
    const n = (x: ReadonlySet<string> | '*') =>
      x === '*' ? 'any' : String(x.size);
    return `mode=${this.mode} writes=${this.writes} cohort=${this.cohort.size} writeSalons=${n(this.writeSalons)} writeActions=${n(this.writeActions)}`;
  }
}

export const rolloutFromEnv = () => new AssistantRollout(process.env);
