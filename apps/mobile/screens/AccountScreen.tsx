import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../lib/auth-context';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Account'>;

export default function AccountScreen({ navigation }: Props) {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>{user?.phone}</Text>

      <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('SalonSearch')}>
        <Text style={styles.buttonText}>Find a salon</Text>
      </Pressable>
      <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('MyBookings')}>
        <Text style={styles.buttonText}>My bookings</Text>
      </Pressable>
      <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('StyleAdvisor')}>
        <Text style={styles.buttonText}>AI Style Advisor</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', alignItems: 'stretch', padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#EDE6DA', textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#B8AFA0', marginTop: 8, marginBottom: 32, textAlign: 'center' },
  primaryButton: { backgroundColor: '#B0413E', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 16 },
  button: { backgroundColor: '#1C1A17', borderWidth: 1, borderColor: '#B8AFA0', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
});
