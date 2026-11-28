import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';

export default function RoleSelectScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>BarberCue</Text>
      <Text style={styles.subtitle}>Skip the wait. Book your chair.</Text>

      <Pressable style={styles.button} onPress={() => navigation.navigate('ShopList')}>
        <Text style={styles.buttonText}>I'm a customer</Text>
      </Pressable>

      <Pressable
        style={[styles.button, styles.buttonOutline]}
        onPress={() => navigation.navigate('OwnerDashboard')}
      >
        <Text style={[styles.buttonText, styles.buttonOutlineText]}>I run a shop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', padding: 24 },
  title: { fontSize: 34, fontWeight: '700', color: '#EDE6DA', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#B8AFA0', textAlign: 'center', marginTop: 8, marginBottom: 48 },
  button: {
    backgroundColor: '#B0413E',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#B8AFA0' },
  buttonText: { color: '#EDE6DA', fontSize: 16, fontWeight: '600' },
  buttonOutlineText: { color: '#EDE6DA' },
});
