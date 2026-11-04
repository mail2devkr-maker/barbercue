import type { AuthenticatedUser } from '@barbercue/shared';

/**
 * Who may use the FastQue Action Assistant (issue #362 release gate). FAIL CLOSED: anything other than
 * an exact recognised value means OFF, so a missing, misspelt or empty variable hides the assistant.
 *
 *   ASSISTANT_MODE            off (default) | cohort | all
 *   ASSISTANT_COHORT_USER_IDS comma-separated user UUIDs (the allowlisted test cohort)
 *   ASSISTANT_WRITES          off (default) | cohort | all
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

  constructor(env: Record<string, string | undefined>) {
    this.mode = level(env.ASSISTANT_MODE);
    this.writes = level(env.ASSISTANT_WRITES);
    this.cohort = new Set(
      (env.ASSISTANT_COHORT_USER_IDS ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => UUID.test(s)),
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

  /** A log-safe description: counts only, never the user ids. */
  describe(): string {
    return `mode=${this.mode} writes=${this.writes} cohort=${this.cohort.size}`;
  }
}

export const rolloutFromEnv = () => new AssistantRollout(process.env);
