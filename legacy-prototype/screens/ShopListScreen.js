import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable } from 'react-native';
import { shops, shopStatus } from '../data/mockData';

export default function ShopListScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <FlatList
        data={shops}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const status = shopStatus(item);
          const freeChairs = item.chairs - item.busyChairs;
          return (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate('ShopDetail', { shop: item })}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName}>{item.name}</Text>
                  <Text style={styles.shopMeta}>
                    {item.distance} · {freeChairs} of {item.chairs} chairs free
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: status.color + '22' }]}>
                  <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F2EA' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E7E0D3',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  shopName: { fontSize: 16, fontWeight: '600', color: '#1C1A17' },
  shopMeta: { fontSize: 13, color: '#6B6357', marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
