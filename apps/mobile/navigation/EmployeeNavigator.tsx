import { createNativeStackNavigator } from '@react-navigation/native-stack';
import EmployeeDashboardScreen from '../screens/employee/EmployeeDashboardScreen';
import AssistantScreen from '../screens/AssistantScreen';
import { lightStackOptions } from './screenOptions';
import { useLanguage } from '../lib/language-context';

export type EmployeeStackParamList = {
  EmployeeDashboard: undefined;
  Assistant: undefined;
};

const Stack = createNativeStackNavigator<EmployeeStackParamList>();

/** Separate employee shell. It is mounted only for a verified FIELD_EXECUTIVE/EMPLOYEE session. */
export default function EmployeeNavigator() {
  const { t } = useLanguage();
  return (
    <Stack.Navigator screenOptions={lightStackOptions}>
      <Stack.Screen
        name="EmployeeDashboard"
        component={EmployeeDashboardScreen}
        options={{ title: t.employeeDashboardNavTitle }}
      />
      <Stack.Screen name="Assistant" component={AssistantScreen} options={{ title: 'FastQue Assistant' }} />
    </Stack.Navigator>
  );
}
