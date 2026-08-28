import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import StyleAdvisorScreen from '../screens/StyleAdvisorScreen';
import { styleAdvisorHeaderOptions } from './screenOptions';
import type { HomeStackParamList } from './types';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStack() {
  return (
    <Stack.Navigator>
      {/* Home renders its own branded header (SectionHeader) — no native header needed for a
          tab-root screen with nowhere to go "back" from. */}
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      {/* StyleAdvisorScreen keeps its unchanged dark theme this checkpoint. */}
      <Stack.Screen name="StyleAdvisor" component={StyleAdvisorScreen} options={styleAdvisorHeaderOptions} />
    </Stack.Navigator>
  );
}
