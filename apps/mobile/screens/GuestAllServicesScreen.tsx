import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AllServicesContent } from './AllServicesScreen';
import type { AuthStackParamList } from '../navigation/AuthStack';

/** The same catalogue for signed-out visitors: a service opens the guest shop search (browse first, sign in last). */
export default function GuestAllServicesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  return (
    <AllServicesContent
      onOpenService={(entry) =>
        navigation.navigate('GuestBrowse', { screen: 'SalonSearch', params: { initialQuery: entry.query, searchNonce: Date.now() } })
      }
    />
  );
}
