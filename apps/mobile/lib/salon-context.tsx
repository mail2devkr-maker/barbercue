import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DISCOVERY_PATHS, type SalonWorkplaceDto } from '@barbercue/shared';
import { apiFetch } from './api';

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
 * Owner/Staff navigators (see App.tsx), never for customers. Auto-selects the only workplace when
 * there's exactly one — the common case — otherwise the Dashboard/Today screens render a picker.
 */
export function SalonProvider({ children }: { children: React.ReactNode }) {
  const [workplaces, setWorkplaces] = useState<SalonWorkplaceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSalonId, setSelectedSalonId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    return apiFetch<SalonWorkplaceDto[]>(`${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.workplaces}`)
      .then((result) => {
        setWorkplaces(result);
        setSelectedSalonId((prev) => prev ?? (result.length === 1 ? result[0].id : null));
      })
      .catch(() => setError('Could not load your salons.'))
      .finally(() => setLoading(false));
  }, []);

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
      selectSalon: setSelectedSalonId,
      reload: () => void load(),
    }),
    [workplaces, loading, error, selectedSalonId, selectedSalon, load],
  );

  return <SalonContext.Provider value={value}>{children}</SalonContext.Provider>;
}

export function useSalon(): SalonContextValue {
  const ctx = useContext(SalonContext);
  if (!ctx) throw new Error('useSalon must be used within a SalonProvider');
  return ctx;
}
