import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth-context';

export default function AccountScreen() {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome back</Text>
      <Text style={styles.subtitle}>{user?.phone}</Text>
      <Pressable style={styles.button} onPress={() => void logout()}>
        <Text style={styles.buttonText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1A17', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#EDE6DA' },
  subtitle: { fontSize: 15, color: '#B8AFA0', marginTop: 8, marginBottom: 32 },
  button: { backgroundColor: '#1C1A17', borderWidth: 1, borderColor: '#B8AFA0', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  buttonText: { color: '#EDE6DA', fontSize: 15, fontWeight: '600' },
});
