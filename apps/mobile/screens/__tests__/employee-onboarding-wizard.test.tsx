import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import EmployeeOnboardingWizardScreen from '../employee/EmployeeOnboardingWizardScreen';
import { apiFetch } from '../../lib/api';
import { pickServiceSheet } from '../../lib/service-sheet-picker';

jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-location', () => ({ Accuracy: {} }));
jest.mock('../../lib/image-upload', () => ({ IMAGE_UPLOAD_PREPARATION_MESSAGE: 'x', ImageUploadPreparationError: class extends Error {}, uploadImageAsset: jest.fn() }));
jest.mock('../../lib/api', () => ({
  apiFetch: jest.fn(),
  apiUploadImage: jest.fn(),
  getAccessToken: () => 'token',
  getApiBaseUrl: () => 'https://api.test',
  ApiError: class ApiError extends Error {},
  NativeUploadError: class NativeUploadError extends Error {},
}));
jest.mock('../../lib/service-sheet-picker', () => ({
  canPickServiceSheet: () => true,
  pickServiceSheet: jest.fn(),
  shareServiceSheetTemplate: jest.fn(),
}));

jest.mock('../../components/ui', () => {
  const { createElement } = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  return {
    PremiumButton: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', onPress, disabled }, createElement(Text, null, title)),
    PremiumCard: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    PremiumScreen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    PremiumTextField: (props: object) => createElement(TextInput, props),
  };
});

const app = {
  id: 'app-1', reference: 'FQ-ON-1', salonName: 'Synthetic Salon', status: 'DRAFT', canEdit: true, version: 1,
  assignedEmployee: { fullName: 'Field Exec', employeeCode: 'FQ-FE-1' },
  hours: [], services: [], media: [], coordinates: null, locationVerified: false, photoExceptionReason: null,
  changeRequest: null, rejectionReason: null, missing: [],
};

test('service menu step imports rows from an Excel file as unconfirmed services', async () => {
  (apiFetch as jest.Mock).mockResolvedValue(app);
  (pickServiceSheet as jest.Mock).mockResolvedValue({
    fileName: 'menu.xlsx',
    notes: [],
    rows: [{ serviceName: 'Haircut', category: 'Hair', applicableGender: 'MEN', basePrice: 200, priceType: 'FIXED', discountedPrice: null, durationMinutes: 30, description: null, uncertainFields: [] }],
  });
  const navigation = { setOptions: jest.fn(), goBack: jest.fn() };
  render(<EmployeeOnboardingWizardScreen route={{ key: 'k', name: 'EmployeeOnboardingWizard', params: { applicationId: 'app-1' } } as never} navigation={navigation as never} />);
  await waitFor(() => expect(screen.getByText('Synthetic Salon')).toBeTruthy());
  fireEvent.press(screen.getByText('5. Service menu'));
  await waitFor(() => expect(screen.getByText('Import Excel / CSV')).toBeTruthy());
  fireEvent.press(screen.getByText('Import Excel / CSV'));
  await waitFor(() => expect(screen.getByText(/1 service\(s\) imported from menu.xlsx/)).toBeTruthy());
  expect(screen.getByDisplayValue('Haircut')).toBeTruthy();
  expect(screen.getByText('Services (1)')).toBeTruthy();
});
