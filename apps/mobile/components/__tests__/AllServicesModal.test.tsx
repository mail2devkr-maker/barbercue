import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AllServicesModal } from '../AllServicesModal';
import { SERVICE_CATALOG } from '../../lib/service-catalog';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../ui', () => {
  const { View } = require('react-native');
  const { createElement } = require('react');
  return { SafeImage: ({ alt }: { alt: string }) => createElement(View, { accessibilityLabel: `image:${alt}` }) };
});

describe('AllServicesModal (owner report 14 Nov: View all opened search)', () => {
  it('shows every service with a picture and searches the one tapped', async () => {
    const onPick = jest.fn();
    await render(<AllServicesModal visible hindi={false} onClose={jest.fn()} onPick={onPick} />);
    expect(screen.getByText('All services')).toBeTruthy();
    for (const item of SERVICE_CATALOG.slice(0, 9)) {
      expect(screen.getByLabelText(`image:${item.en}`)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId('all-services-Facial'));
    expect(onPick).toHaveBeenCalledWith('Facial');
  });

  it('uses Hindi labels when the app is in Hindi', async () => {
    await render(<AllServicesModal visible hindi onClose={jest.fn()} onPick={jest.fn()} />);
    expect(screen.getByText('सभी सेवाएं')).toBeTruthy();
    expect(screen.getByText('हेयरकट')).toBeTruthy();
  });

  it('every catalog photo comes from the FastQue editorial library', () => {
    expect(SERVICE_CATALOG.length).toBeGreaterThanOrEqual(18);
    for (const item of SERVICE_CATALOG) expect(item.imageUrl.startsWith('https://fastque.com/editorial/')).toBe(true);
  });
});
