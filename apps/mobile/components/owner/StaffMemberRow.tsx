import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { SalonStaffDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { ownerOpsPaths } from '../../lib/owner/ops';
import { space } from '../../lib/theme';
import { InlineError, PremiumButton } from '../ui';
import { StatusPill } from './ops-ui';
import { styles as sectionStyles } from './ShopSetupSections';

/**
 * One barber on the owner's team: duty status, whether they can sign in, and the owner's access
 * controls. Removing access signs the barber out of this shop and stops them clocking in (their past
 * work and records stay untouched); it is refused while they are serving a customer. Restoring access
 * lets them sign in again. The server enforces every rule - this only asks first.
 */
export function StaffMemberRow({
  salonId,
  member,
  invitePendingSuffix,
  onChanged,
}: {
  salonId: string;
  member: SalonStaffDto;
  invitePendingSuffix: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoked = Boolean(member.accessRevoked);

  async function change(action: 'revoke' | 'restore') {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(ownerOpsPaths.staffAccess(salonId, member.id, action), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({}),
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change this barber’s access. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRevoke() {
    Alert.alert(`Remove ${member.displayName}’s access?`, 'They will be signed out of this shop and cannot clock in. Their past work and records are kept. You can restore access later.', [
      { text: 'Keep access', style: 'cancel' },
      { text: 'Remove access', style: 'destructive', onPress: () => void change('revoke') },
    ]);
  }

  return (
    <View style={[sectionStyles.row, styles.row]}>
      <View style={sectionStyles.rowBody}>
        <Text style={sectionStyles.rowTitle}>{member.displayName}</Text>
        <Text style={sectionStyles.rowMeta}>
          {member.status} {member.hasPassword ? '' : invitePendingSuffix}
        </Text>
        {revoked ? (
          <View style={styles.pill}>
            <StatusPill label="Login access removed" tone="danger" />
          </View>
        ) : null}
        {error && <InlineError message={error} />}
      </View>
      {member.roleInSalon !== 'OWNER' && (
        <PremiumButton
          testID={`staff-access-${member.id}`}
          title={revoked ? 'Restore access' : 'Remove access'}
          variant="secondary"
          loading={busy}
          onPress={() => (revoked ? void change('restore') : confirmRevoke())}
          style={styles.button}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', gap: space[2] },
  pill: { marginTop: space[1] },
  button: { minHeight: 44, minWidth: 140 },
});
