import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { slotsByShop } from '../data/mockData';

export default function ShopDetailScreen({ route, navigation }) {
  const { shop } = route.params;
  const [selected, setSelected] = useState(null);
  const slots = slotsByShop[shop.id] || [];

  return (
    <View style={styles.container}>
      <Text style={styles.shopName}>{shop.name}</Text>
      <Text style={styles.label}>Pick an open time slot</Text>

      <FlatList
        data={slots}
        keyExtractor={(item) => item}
        numColumns={3}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ gap: 10, marginTop: 12 }}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.slot, selected === item && styles.slotSelected]}
            onPress={() => setSelected(item)}
          >
            <Text style={[styles.slotText, selected === item && styles.slotTextSelected]}>
              {item}
            </Text>
          </Pressable>
        )}
      />

      <Pressable
        style={[styles.confirmButton, !selected && styles.confirmButtonDisabled]}
        disabled={!selected}
        onPress={() => navigation.navigate('BookingConfirm', { shop, time: selected })}
      >
        <Text style={styles.confirmText}>Book {selected || 'a slot'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F2EA', padding: 16 },
  shopName: { fontSize: 20, fontWeight: '700', color: '#1C1A17' },
  label: { fontSize: 13, color: '#6B6357', marginTop: 4 },
  slot: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E7E0D3',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  slotSelected: { backgroundColor: '#B0413E', borderColor: '#B0413E' },
  slotText: { fontSize: 13, color: '#1C1A17' },
  slotTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  confirmButton: {
    marginTop: 24,
    backgroundColor: '#B0413E',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmButtonDisabled: { opacity: 0.4 },
  confirmText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
