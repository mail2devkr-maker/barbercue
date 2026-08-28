import { createNativeStackNavigator } from '@react-navigation/native-stack';
import QueueScreen from '../screens/QueueScreen';
import type { QueueStackParamList } from './types';

const Stack = createNativeStackNavigator<QueueStackParamList>();

export default function QueueStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="QueueHome" component={QueueScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
