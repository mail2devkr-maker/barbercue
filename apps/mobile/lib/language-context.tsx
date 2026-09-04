import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AUTH_PATHS, Language, uiStringsFor, type UiStrings } from '@barbercue/shared';
import { apiFetch } from './api';
import { getItem, setItem } from './secure-storage';
import { useAuth } from './auth-context';
import { setCurrentLanguage } from './current-language';

const LANGUAGE_STORAGE_KEY = 'barbercue_ui_language';

interface LanguageContextValue {
  language: Language;
  t: UiStrings;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: Language.EN,
  t: uiStringsFor(Language.EN),
  setLanguage: () => {},
});

/**
 * Issue 9 (mobile launch mission) — a language preference reachable before authentication.
 * Anonymous/pre-auth state lives in SecureStore (persists across restarts, never touches the
 * backend); once authenticated, `user.preferredLanguage` (the same field PATCH auth/language and
 * the voice announcements already read — see AccountScreen's own switcher) becomes the source of
 * truth and is mirrored into local storage, so logging out doesn't silently revert the choice.
 * Deliberately does NOT touch SPEECH_LOCALE/voice behavior itself — OwnerBookingsScreen reads
 * user.preferredLanguage directly, exactly as before; this only adds a second consumer (UI text)
 * of the same underlying preference.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { status, user, refreshMe } = useAuth();
  const [language, setLanguageState] = useState<Language>(Language.EN);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getItem(LANGUAGE_STORAGE_KEY).then((stored) => {
      if (cancelled) return;
      if (stored === Language.EN || stored === Language.HI) {
        setLanguageState(stored);
        setCurrentLanguage(stored);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once signed in, the account's own saved preference wins (matches whatever was set here, on
  // web, or by an owner/staff account on a different device) — but only after local hydration, so
  // a fresh anonymous choice is never clobbered by a stale value mid-load.
  useEffect(() => {
    if (!hydrated || status !== 'authenticated' || !user?.preferredLanguage) return;
    setLanguageState(user.preferredLanguage);
    setCurrentLanguage(user.preferredLanguage);
    void setItem(LANGUAGE_STORAGE_KEY, user.preferredLanguage);
  }, [hydrated, status, user?.preferredLanguage]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      setCurrentLanguage(next);
      void setItem(LANGUAGE_STORAGE_KEY, next);
      if (status === 'authenticated') {
        apiFetch(`auth/${AUTH_PATHS.language}`, { method: 'PATCH', body: JSON.stringify({ language: next }) })
          .then(() => refreshMe())
          .catch(() => {
            /* local preference already applied; server sync retried next time setLanguage runs */
          });
      }
    },
    [status, refreshMe],
  );

  return (
    <LanguageContext.Provider value={{ language, t: uiStringsFor(language), setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
