import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import RoleSelectScreen from './screens/RoleSelectScreen';
import ShopListScreen from './screens/ShopListScreen';
import ShopDetailScreen from './screens/ShopDetailScreen';
import BookingConfirmScreen from './screens/BookingConfirmScreen';
import OwnerDashboardScreen from './screens/OwnerDashboardScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1C1A17' },
          headerTintColor: '#EDE6DA',
          headerTitleStyle: { fontWeight: '600' },
        }}
      >
        <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ title: 'BarberCue' }} />
        <Stack.Screen name="ShopList" component={ShopListScreen} options={{ title: 'Nearby shops' }} />
        <Stack.Screen name="ShopDetail" component={ShopDetailScreen} options={{ title: 'Book a slot' }} />
        <Stack.Screen name="BookingConfirm" component={BookingConfirmScreen} options={{ title: 'Confirmation', headerBackVisible: false }} />
        <Stack.Screen name="OwnerDashboard" component={OwnerDashboardScreen} options={{ title: 'Shop dashboard' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
