/// <reference types="jest" />
import React from 'react';
import { render, screen } from '@testing-library/react-native';

// Simulates an OLDER binary on the same EAS Update channel + runtime (Android 1.0.7 vc30-33,
// iOS 1.0.6 builds 6-8) that does not contain the newer native modules.
jest.mock('../native-availability', () => ({ hasExpoNativeModule: () => false, hasTurboNativeModule: () => false }));
// If any of these were imported eagerly the test would fail, exactly like the app would crash.
jest.mock('expo-document-picker', () => { throw new Error('ExpoDocumentPicker is not in this binary'); });
jest.mock('expo-speech-recognition', () => { throw new Error('ExpoSpeechRecognition is not in this binary'); });
jest.mock('react-native-view-shot', () => { throw new Error('RNViewShot is not in this binary'); });
jest.mock('../api', () => ({ apiFetch: jest.fn(async () => ({ features: {} })), ApiError: class ApiError extends Error {} }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn(), EncodingType: { UTF8: 'utf8' } }));
jest.mock('../../components/ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement } = require('react');
  return {
    Card: View,
    InlineError: ({ message }: { message: string }) => createElement(Text, null, message),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, createElement(Text, null, title)),
  };
});

describe('an OTA update never crashes an older binary (13 Nov)', () => {
  it('loads the contacts panel and hides file import when the picker is missing', async () => {
    const { ContactsCheckPanel } = require('../../components/owner/ContactsCheckPanel');
    await render(<ContactsCheckPanel salonId="s1" />);
    expect(screen.queryByLabelText('Import a contacts file (.csv, .txt, .vcf)')).toBeNull();
  });

  it('reports voice as unavailable instead of crashing when speech recognition is missing', async () => {
    const voice = require('../native-voice');
    expect(voice.voiceRecognitionAvailable()).toBe(false);
    await expect(voice.ensureVoicePermission()).resolves.toBe(false);
    const recognizer = voice.createNativeRecognizer();
    const onerror = jest.fn();
    const onend = jest.fn();
    recognizer.onerror = onerror;
    recognizer.onend = onend;
    recognizer.start();
    expect(onerror).toHaveBeenCalledWith({ error: 'service-not-allowed' });
    expect(onend).toHaveBeenCalled();
  });

  it('loads the premium QR module without the screenshot library', () => {
    expect(() => require('../../components/owner/PremiumQueueQr')).not.toThrow();
  });
});
