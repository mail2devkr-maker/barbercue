import { OTP_RESEND_COOLDOWN_SECONDS } from '@barbercue/shared';
import { ApiError, apiFetch } from '../api';
import {
  OWNER_OTP_PATHS,
  classifyOtpError,
  cleanOtpInput,
  cooldownUntil,
  fetchOwnerPhoneOtpAvailable,
  isValidE164,
  isValidOtpCode,
  normalizeDialCode,
  requestOwnerOtp,
  secondsLeft,
  toE164,
  verifyOwnerOtp,
} from '../owner-phone-otp';

jest.mock('../api', () => {
  class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, body: { error: { code: string; message: string } }) {
      super(body.error.message);
      this.status = status;
      this.code = body.error.code;
    }
  }
  return { ApiError, apiFetch: jest.fn() };
});

const mockFetch = apiFetch as jest.Mock;
const apiError = (status: number) => new ApiError(status, { error: { code: 'X', message: 'm' } });

beforeEach(() => jest.clearAllMocks());

describe('phone number handling', () => {
  it('normalises a country calling code', () => {
    expect(normalizeDialCode('+91')).toBe('+91');
    expect(normalizeDialCode('91')).toBe('+91');
    expect(normalizeDialCode(' + 9 1 ')).toBe('+91');
    expect(normalizeDialCode('+1')).toBe('+1');
    expect(normalizeDialCode('+0')).toBeNull();
    expect(normalizeDialCode('+1234')).toBeNull();
    expect(normalizeDialCode('')).toBeNull();
  });

  it('builds E.164 from the typed number, ignoring spaces, dashes, brackets and a trunk zero', () => {
    expect(toE164('+91', '98765 43210')).toBe('+919876543210');
    expect(toE164('91', '(98765)-43210')).toBe('+919876543210');
    expect(toE164('+91', '098765 43210')).toBe('+919876543210');
    expect(toE164('+44', '7700 900123')).toBe('+447700900123');
  });

  it('rejects numbers that cannot be valid', () => {
    expect(toE164('+91', '')).toBeNull();
    expect(toE164('+91', '12')).toBeNull();
    expect(toE164('+91', '1'.repeat(20))).toBeNull();
    expect(toE164('', '9876543210')).toBeNull();
    expect(toE164('+91', 'abc')).toBeNull();
  });

  it('validates E.164 strictly', () => {
    expect(isValidE164('+919876543210')).toBe(true);
    expect(isValidE164('919876543210')).toBe(false);
    expect(isValidE164('+0919876543210')).toBe(false);
    expect(isValidE164('+91 9876543210')).toBe(false);
  });
});

describe('code handling', () => {
  it('accepts exactly six ASCII digits', () => {
    expect(isValidOtpCode('012345')).toBe(true);
    expect(isValidOtpCode('12345')).toBe(false);
    expect(isValidOtpCode('1234567')).toBe(false);
    expect(isValidOtpCode('12345a')).toBe(false);
    expect(isValidOtpCode('١٢٣٤٥٦')).toBe(false); // non-ASCII digits
  });
  it('cleans input to at most six digits', () => {
    expect(cleanOtpInput('12 34-56 78')).toBe('123456');
    expect(cleanOtpInput('abc')).toBe('');
  });
});

describe('resend cooldown', () => {
  it('uses the shared 45 second cooldown and counts down without going negative', () => {
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(45);
    const start = 1_000_000;
    const until = cooldownUntil(start);
    expect(until - start).toBe(45_000);
    expect(secondsLeft(until, start)).toBe(45);
    expect(secondsLeft(until, start + 1)).toBe(45);
    expect(secondsLeft(until, start + 44_001)).toBe(1);
    expect(secondsLeft(until, start + 45_000)).toBe(0);
    expect(secondsLeft(until, start + 90_000)).toBe(0);
  });
});

describe('classifyOtpError', () => {
  it('maps server answers to recoverable states without telling apart account cases', () => {
    expect(classifyOtpError(apiError(429))).toBe('RATE_LIMITED');
    for (const status of [400, 401, 403, 404, 409, 422]) expect(classifyOtpError(apiError(status))).toBe('INVALID_OR_EXPIRED');
    for (const status of [502, 503, 504]) expect(classifyOtpError(apiError(status))).toBe('UNAVAILABLE');
    expect(classifyOtpError(apiError(500))).toBe('OTHER');
  });
  it('treats a non-API failure (offline, timeout) as a network problem', () => {
    expect(classifyOtpError(new TypeError('Network request failed'))).toBe('NETWORK');
  });
});

describe('capability probe', () => {
  it('is on only when the server says ownerPhoneOtp is true', async () => {
    mockFetch.mockResolvedValueOnce({ google: true, phoneOtp: true, ownerPhoneOtp: true });
    await expect(fetchOwnerPhoneOtpAvailable()).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(OWNER_OTP_PATHS.methods);
  });
  it('is off when the field is false or missing (older backend), or the call fails', async () => {
    mockFetch.mockResolvedValueOnce({ google: true, phoneOtp: true, ownerPhoneOtp: false });
    await expect(fetchOwnerPhoneOtpAvailable()).resolves.toBe(false);
    mockFetch.mockResolvedValueOnce({ google: true, phoneOtp: true });
    await expect(fetchOwnerPhoneOtpAvailable()).resolves.toBe(false);
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchOwnerPhoneOtpAvailable()).resolves.toBe(false);
  });
});

describe('API calls', () => {
  it('requests a code with only the phone number', async () => {
    mockFetch.mockResolvedValueOnce({});
    await requestOwnerOtp('+919876543210');
    expect(mockFetch).toHaveBeenCalledWith('auth/owner/otp/request', { method: 'POST', body: JSON.stringify({ phone: '+919876543210' }) });
  });
  it('verifies with the phone and the six-digit code and returns the session', async () => {
    const session = { user: { id: 'u1' }, tokens: { accessToken: 'a', refreshToken: 'r' } };
    mockFetch.mockResolvedValueOnce(session);
    await expect(verifyOwnerOtp('+919876543210', '012345')).resolves.toBe(session);
    expect(mockFetch).toHaveBeenCalledWith('auth/owner/otp/verify', { method: 'POST', body: JSON.stringify({ phone: '+919876543210', code: '012345' }) });
  });
});
