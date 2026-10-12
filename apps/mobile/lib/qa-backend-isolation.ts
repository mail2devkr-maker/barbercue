/**
 * Isolation guard for Android QA binaries.
 *
 * A separate EAS channel/runtime does NOT mean the API/backend is isolated.
 * The legacy API client has a deliberate production fallback for the public app.
 * When EXPO_PUBLIC_FASTQUE_QA_ISOLATED is "true", fail closed instead:
 * require an explicit, local-only API origin to prevent sending QA traffic to
 * FastQue production. A hosted QA API must undergo a separate backend/database
 * identity audit before it can be added to this allowlist.
 *
 * This is a build/runtime traffic guard, NOT proof that the developer's
 * local backend uses a disposable database. Verify that independently.
 */
export interface MobileApiConfiguration {
  configuredUrl?: string;
  qaIsolated: boolean;
  development: boolean;
}

const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000/api/v1';
const PRODUCTION_API_BASE_URL =
  'https://barbercuebackend-production.up.railway.app/api/v1';

const LOCAL_QA_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '10.0.2.2', // Standard Android Emulator loopback -> development host
]);

export const QA_BACKEND_ISOLATION_ERROR =
  'FastQue QA backend is not verified. Configure an explicit local test API ' +
  '(localhost, 127.0.0.1 or Android Emulator 10.0.2.2) and a disposable ' +
  'backend database before running QA. Production fallback is disabled.';

function isApprovedLocalQaApi(value: string): boolean {
  // Requiring an explicit /api/v1 path also rejects ambiguous scheme-relative
  // URLs, query strings, fragments, embedded credentials and untrusted suffixes.
  const match = /^https?:\/\/([^/?#]+)\/api\/v1\/?$/i.exec(value);
  if (!match) return false;

  const authority = match[1].toLowerCase();
  if (authority.includes('@') || authority.includes('[') || authority.includes(']')) {
    return false;
  }
  const parts = authority.split(':');
  if (parts.length > 2 || !LOCAL_QA_HOSTS.has(parts[0])) return false;
  if (parts.length === 2 && !/^[0-9]{1,5}$/.test(parts[1])) return false;
  const port = parts.length === 2 ? Number(parts[1]) : null;
  if (port !== null && (port < 1 || port > 65535)) return false;

  return true;
}

export function resolveMobileApiBaseUrl(options: MobileApiConfiguration): string {
  const configured = options.configuredUrl?.trim();

  if (!options.qaIsolated) {
    // Keep existing production/customer behavior unchanged. The public release
    // intentionally uses a known origin when its EAS URL is absent.
    return configured || (options.development ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL);
  }

  if (!configured || !isApprovedLocalQaApi(configured)) {
    throw new Error(QA_BACKEND_ISOLATION_ERROR);
  }

  return configured.replace(/\/$/, '');
}
