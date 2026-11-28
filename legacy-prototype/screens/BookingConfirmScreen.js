import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

export default function BookingConfirmScreen({ route, navigation }) {
  const { shop, time } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.checkmark}>✓</Text>
      <Text style={styles.title}>Slot booked</Text>
      <Text style={styles.detail}>{shop.name}</Text>
      <Text style={styles.detail}>{time}</Text>

      <Pressable
        style={styles.button}
        onPress={() => navigation.popToTop()}
      >
        <Text style={styles.buttonText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F2EA', justifyContent: 'center', alignItems: 'center', padding: 24 },
  checkmark: { fontSize: 40, color: '#3B6D11', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700', color: '#1C1A17' },
  detail: { fontSize: 14, color: '#6B6357', marginTop: 4 },
  button: {
    marginTop: 32,
    backgroundColor: '#1C1A17',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  buttonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
});
