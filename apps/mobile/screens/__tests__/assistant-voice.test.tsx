import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AssistantScreen from '../AssistantScreen';
import { apiFetch } from '../../lib/api';

jest.mock('@react-navigation/native', () => ({ useFocusEffect: (fn: () => void | (() => void)) => require('react').useEffect(fn, []) }));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { status = 0; } }));
jest.mock('../../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', roles: ['CUSTOMER'], audience: 'CUSTOMER', preferredLanguage: 'HI' } }) }));
jest.mock('../../lib/salon-context', () => ({ useOptionalSalon: () => null }));
jest.mock('../../navigation/navigation-ref', () => ({ navigationRef: { navigate: jest.fn(), isReady: () => true } }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mockRecognizer: any = { lang: '', interimResults: true, continuous: true, maxAlternatives: 5, onresult: null, onerror: null, onend: null, onaudiostart: null, start: jest.fn(), stop: jest.fn(), abort: jest.fn() };
jest.mock('../../lib/native-voice', () => ({
  VOICE_LANGS: [{ id: 'hi-IN', label: 'हिंदी / Hinglish' }, { id: 'en-IN', label: 'English' }],
  createNativeRecognizer: () => mockRecognizer,
  ensureVoicePermission: async () => true,
  voiceRecognitionAvailable: () => true,
}));
const mockSpeak = jest.fn(async () => ({ ok: true }));
jest.mock('../../lib/speech-output', () => ({
  ...jest.requireActual('../../lib/speech-output'),
  createNativeSpeaker: () => ({ speak: mockSpeak, cancel: jest.fn() }),
}));

const fetchMock = apiFetch as jest.Mock;

beforeEach(() => {
  fetchMock.mockReset();
  mockSpeak.mockClear();
  fetchMock.mockImplementation(async (path: string, init?: { body?: string }) => {
    if (path.endsWith('/access')) return { enabled: true, writes: false };
    if (path.endsWith('/capabilities')) return { actions: [] };
    if (path.endsWith('/turns')) {
      const body = JSON.parse(init!.body!);
      return { requestId: 'r1', status: 'DONE', message: `Aaj 3 chairs free hain (${body.inputMode})`, surface: 'customer' };
    }
    throw new Error(path);
  });
});

it('offers a voice conversation, voice settings and a microphone, like the website', async () => {
  await render(<AssistantScreen />);
  expect(await screen.findByText('🎤  Start voice conversation')).toBeTruthy();
  expect(screen.getByLabelText('Speak a question')).toBeTruthy();
  await fireEvent.press(screen.getByText('Voice settings & speaker test'));
  expect(screen.getByText('हिंदी / Hinglish')).toBeTruthy();
  expect(screen.getByLabelText('Speak replies to voice questions')).toBeTruthy();
});

it('push-to-talk sends the spoken question once as voice input and speaks the reply', async () => {
  await render(<AssistantScreen />);
  await fireEvent.press(await screen.findByLabelText('Speak a question'));
  await waitFor(() => expect(mockRecognizer.start).toHaveBeenCalled());
  expect(mockRecognizer.lang).toBe('hi-IN');
  await act(async () => {
    mockRecognizer.onresult({ results: [Object.assign([{ transcript: 'kitni chairs free hain', confidence: 0.9 }], { isFinal: true })] });
    mockRecognizer.onend();
  });
  await waitFor(() => expect(mockSpeak).toHaveBeenCalledWith('Aaj 3 chairs free hain (voice)', 'hi-IN'));
  const turns = fetchMock.mock.calls.filter(([p]) => String(p).endsWith('/turns'));
  expect(turns).toHaveLength(1);
  expect(JSON.parse(turns[0][1].body)).toMatchObject({ text: 'kitni chairs free hain', inputMode: 'voice', confidence: 0.9 });
});

it('typed questions still go as text and are not spoken', async () => {
  await render(<AssistantScreen />);
  await fireEvent.changeText(await screen.findByLabelText('Message FastQue Assistant'), 'Bookings kholo');
  await fireEvent.press(screen.getByText('Send'));
  await waitFor(() => expect(fetchMock.mock.calls.some(([p]) => String(p).endsWith('/turns'))).toBe(true));
  const body = JSON.parse(fetchMock.mock.calls.find(([p]) => String(p).endsWith('/turns'))![1].body);
  expect(body.inputMode).toBe('text');
  expect(mockSpeak).not.toHaveBeenCalled();
});
