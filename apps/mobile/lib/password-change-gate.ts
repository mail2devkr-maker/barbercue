/**
 * The backend refuses every route for an account that still holds an administrator-issued temporary password
 * (403 PASSWORD_CHANGE_REQUIRED). The app does not host the password-change form; it hands the person to the FastQue
 * website, where the change is completed. This tiny registry lets the API layer announce the condition to the app root
 * without importing any UI. It never sees a password or a token.
 */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED';

type Listener = () => void;
const listeners = new Set<Listener>();

export function isPasswordChangeRequired(status: number, code: unknown): boolean {
  return status === 403 && code === PASSWORD_CHANGE_REQUIRED_CODE;
}

export function subscribePasswordChangeRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyPasswordChangeRequired(): void {
  for (const listener of [...listeners]) listener();
}

export function passwordChangeUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/+$/, '')}/change-password-required`;
}
