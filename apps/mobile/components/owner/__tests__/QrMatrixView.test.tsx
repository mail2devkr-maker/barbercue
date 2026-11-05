import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { createQrMatrix } from '../../../lib/qr-poster';
import { QrMatrixView } from '../QrMatrixView';

jest.mock('../../../lib/qr-poster', () => ({
  createQrMatrix: jest.fn(() => ({
    size: 3,
    cells: [false, true, false, true, false, true, false, true, false],
  })),
}));

jest.mock('@barbercue/shared', () => ({
  SalonStatus: { ACTIVE: 'ACTIVE' },
}));

describe('QrMatrixView', () => {
  it('renders each QR module as a native square and keeps the whole code accessible as one image', () => {
    const label = 'Public QR code for Example Salon';
    const { getByLabelText, getByTestId, getAllByTestId } = render(
      <QrMatrixView value="https://fastque.com/in/example" label={label} />,
    );

    expect(getByLabelText(label)).toBeTruthy();
    expect(createQrMatrix).toHaveBeenCalledWith('https://fastque.com/in/example');
    expect(getAllByTestId(/^qr-matrix-row-/)).toHaveLength(3);
    expect(getAllByTestId(/^qr-matrix-cell-/)).toHaveLength(9);
    expect(StyleSheet.flatten(getByTestId('qr-matrix-cell-0-1').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#111111' }),
    );
    expect(StyleSheet.flatten(getByTestId('qr-matrix-cell-0-0').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#ffffff' }),
    );
  });

  it('rebuilds the native matrix when the canonical URL changes', () => {
    const { rerender } = render(<QrMatrixView value="https://fastque.com/a" label="Shop QR" />);
    rerender(<QrMatrixView value="https://fastque.com/b" label="Shop QR" />);

    expect(createQrMatrix).toHaveBeenLastCalledWith('https://fastque.com/b');
  });
});
