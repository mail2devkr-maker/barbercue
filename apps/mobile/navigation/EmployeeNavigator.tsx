import { createNativeStackNavigator } from '@react-navigation/native-stack';
import EmployeeDashboardScreen from '../screens/employee/EmployeeDashboardScreen';
import { lightStackOptions } from './screenOptions';
import { useLanguage } from '../lib/language-context';

export type EmployeeStackParamList = {
  EmployeeDashboard: undefined;
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
    </Stack.Navigator>
  );
}
