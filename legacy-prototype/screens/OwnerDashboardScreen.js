import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';

const STATUS_ORDER = ['free', 'busy', 'break'];
const STATUS_META = {
  free: { label: 'Free', color: '#3B6D11' },
  busy: { label: 'With customer', color: '#A32D2D' },
  break: { label: 'On break', color: '#854F0B' },
};

const initialChairs = [
  { id: '1', name: 'Chair 1 — Marcus', status: 'busy' },
  { id: '2', name: 'Chair 2 — Devon', status: 'free' },
  { id: '3', name: 'Chair 3 — Ray', status: 'break' },
];

const todaysBookings = [
  { id: '1', time: '11:00 AM', name: 'J. Alvarez', service: 'Skin fade' },
  { id: '2', time: '11:30 AM', name: 'T. Nguyen', service: 'Beard trim' },
  { id: '3', time: '2:00 PM', name: 'S. Cole', service: 'Fade + line up' },
];

export default function OwnerDashboardScreen() {
  const [chairs, setChairs] = useState(initialChairs);

  const cycleStatus = (id) => {
    setChairs((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: STATUS_ORDER[(STATUS_ORDER.indexOf(c.status) + 1) % STATUS_ORDER.length] }
          : c
      )
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>Chairs</Text>
      {chairs.map((chair) => {
        const meta = STATUS_META[chair.status];
        return (
          <View key={chair.id} style={styles.chairRow}>
            <Text style={styles.chairName}>{chair.name}</Text>
            <View style={styles.chairRight}>
              <View style={[styles.badge, { backgroundColor: meta.color + '22' }]}>
                <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
              </View>
              <Pressable style={styles.updateButton} onPress={() => cycleStatus(chair.id)}>
                <Text style={styles.updateButtonText}>Update</Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Today's bookings</Text>
      <FlatList
        data={todaysBookings}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.bookingRow}>
            <Text style={styles.bookingTime}>{item.time} — {item.name}</Text>
            <Text style={styles.bookingService}>{item.service}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F2EA', padding: 16 },
  sectionLabel: { fontSize: 13, color: '#6B6357', marginBottom: 8, textTransform: 'uppercase' },
  chairRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7E0D3',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  chairName: { fontSize: 14, color: '#1C1A17' },
  chairRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  updateButton: { backgroundColor: '#1C1A17', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  updateButtonText: { color: '#EDE6DA', fontSize: 12, fontWeight: '600' },
  bookingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E7E0D3',
    paddingVertical: 8,
  },
  bookingTime: { fontSize: 13, color: '#1C1A17' },
  bookingService: { fontSize: 13, color: '#6B6357' },
});
