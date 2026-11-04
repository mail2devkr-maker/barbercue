import { useState } from 'react';
import { Text } from 'react-native';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { fastQue } from '../lib/theme';
import { PremiumButton, PremiumScreen, PremiumSectionHeader } from '../components/ui';

/** Unknown or unsupported roles are never routed into the customer marketplace. */
export default function RestrictedSessionScreen() {
  const { logout } = useAuth();
  const { t } = useLanguage();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <PremiumScreen contentStyle={{ justifyContent: 'center' }}>
      <PremiumSectionHeader title={t.restrictedSessionTitle} subtitle={t.restrictedSessionSubtitle} />
      <Text accessibilityRole="alert" style={{ color: fastQue.textSecondary, marginBottom: 20 }}>
        {t.restrictedSessionBody}
      </Text>
      <PremiumButton title={t.signOut} onPress={() => void handleSignOut()} loading={signingOut} />
    </PremiumScreen>
  );
}
