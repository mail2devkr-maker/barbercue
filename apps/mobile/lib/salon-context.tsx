import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DISCOVERY_PATHS, chooseShopHome, type SalonWorkplaceDto } from '@barbercue/shared';
import { apiFetch } from './api';
import { useAuth } from './auth-context';
import { useLanguage } from './language-context';
import { readLastShop, rememberLastShop } from './owner/last-shop';

interface SalonContextValue {
  workplaces: SalonWorkplaceDto[];
  loading: boolean;
  error: string | null;
  selectedSalonId: string | null;
  selectedSalon: SalonWorkplaceDto | null;
  selectSalon: (salonId: string) => void;
  reload: () => void;
}

const SalonContext = createContext<SalonContextValue | null>(null);

/**
 * Owner/staff salon context — GET salons/workplaces ("every salon this user may operate, for
 * owners AND staff", role-gated SALON_OWNER|SALON_STAFF on the backend). Mounted only inside the
 * Owner/Staff navigators (see App.tsx), never for customers.
 *
 * Which shop is selected (the same rule as the website, chooseShopHome): the only workplace when there
 * is exactly one; with several, the shop this account used last - restored after an app relaunch - but
 * ONLY if the server still lists it for them; otherwise nothing is selected and the Dashboard/Today
 * screens render a picker. The remembered id is a hint, never an authorisation.
 */
export function SalonProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [workplaces, setWorkplaces] = useState<SalonWorkplaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return apiFetch<SalonWorkplaceDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.workplaces}`)
      .then(async (result) => {
        // The last shop used on this phone by THIS account (never another account's).
        const remembered = userId ? await readLastShop(userId) : null;
        setWorkplaces(result);
        setSelectedSalonId((prev) => (prev && result.some((w) => w.id === prev) ? prev : chooseShopHome(result, remembered)));
      })
      .catch(() => setError(t.couldNotLoadSalons))
      .finally(() => setLoading(false));
  }, [t, userId]);

  const selectSalon = useCallback(
    (salonId: string) => {
      setSelectedSalonId(salonId);
      if (userId) void rememberLastShop(userId, salonId);
    },
    [userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSalon = useMemo(
    () => workplaces.find((w) => w.id === selectedSalonId) ?? null,
    [workplaces, selectedSalonId],
  );

  const value = useMemo<SalonContextValue>(
    () => ({
      workplaces,
      loading,
      error,
      selectedSalonId,
      selectedSalon,
      selectSalon,
      reload: () => void load(),
    }),
    [workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon, load],
  );

  return <SalonContext.Provider value={value}>{children}</SalonContext.Provider>;
}

export function useSalon(): SalonContextValue {
  const ctx = useContext(SalonContext);
  if (!ctx) throw new Error('useSalon must be used within a SalonProvider');
  return ctx;
}
