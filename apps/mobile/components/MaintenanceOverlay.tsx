import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAINTENANCE_COPY, MAINTENANCE_RETRY_MS } from '@barbercue/shared';
import { getApiBaseUrl } from '../lib/api';
import { setMaintenance, subscribeMaintenance, isMaintenance } from '../lib/maintenance';
import { useLanguage } from '../lib/language-context';

/**
 * Full-screen "under maintenance" notice while the backend is unreachable (for example during the
 * Neon CU guard's database switch). Polls the API health every 15 s and disappears by itself.
 */
export function MaintenanceOverlay() {
  const { language } = useLanguage();
  const [down, setDown] = useState(isMaintenance());

  useEffect(() => subscribeMaintenance(setDown), []);

  useEffect(() => {
    if (!down) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`);
        if (res.ok) setMaintenance(false);
      } catch {
        /* still down */
      }
    }, MAINTENANCE_RETRY_MS);
    return () => clearInterval(id);
  }, [down]);

  if (!down) return null;
  const copy = language === 'HI' ? MAINTENANCE_COPY.HI : MAINTENANCE_COPY.EN;
  return (
    <View style={styles.layer} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999, backgroundColor: 'rgba(9,9,12,0.96)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#f7f5f4', textAlign: 'center', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
});
