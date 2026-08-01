import {
  adminLoginSchema,
  forgotPasswordSchema,
  otpRequestSchema,
  otpVerifySchema,
  resetPasswordSchema,
  staffLoginSchema,
} from '../schemas';

describe('otpRequestSchema', () => {
  it('accepts a valid E.164 phone number', () => {
    expect(otpRequestSchema.safeParse({ phone: '+919876543210' }).success).toBe(true);
  });

  it('rejects a phone number without a country code', () => {
    expect(otpRequestSchema.safeParse({ phone: '9876543210' }).success).toBe(false);
  });
});

describe('otpVerifySchema', () => {
  it('rejects a code that is not exactly 6 digits long', () => {
    expect(otpVerifySchema.safeParse({ phone: '+919876543210', code: '12345' }).success).toBe(false);
  });

  it('accepts a 6-character code', () => {
    expect(otpVerifySchema.safeParse({ phone: '+919876543210', code: '123456' }).success).toBe(true);
  });
});

describe('staffLoginSchema', () => {
  it('rejects a password shorter than 8 characters', () => {
    expect(staffLoginSchema.safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(staffLoginSchema.safeParse({ email: 'not-an-email', password: 'longenough' }).success).toBe(false);
  });

  it('accepts a valid email/password pair', () => {
    expect(staffLoginSchema.safeParse({ email: 'owner@salon.com', password: 'longenough' }).success).toBe(true);
  });
});

describe('adminLoginSchema', () => {
  it('allows totpCode to be omitted (service layer distinguishes TOTP_REQUIRED)', () => {
    expect(adminLoginSchema.safeParse({ email: 'admin@barbercue.app', password: 'longenough' }).success).toBe(true);
  });

  it('rejects a totpCode that is not 6 digits', () => {
    expect(
      adminLoginSchema.safeParse({ email: 'admin@barbercue.app', password: 'longenough', totpCode: '12' }).success,
    ).toBe(false);
  });

  it('accepts a valid 6-digit totpCode', () => {
    expect(
      adminLoginSchema.safeParse({ email: 'admin@barbercue.app', password: 'longenough', totpCode: '123456' })
        .success,
    ).toBe(true);
  });
});

describe('forgotPasswordSchema / resetPasswordSchema', () => {
  it('requires a valid email for forgot-password', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('requires both token and a valid new password for reset-password', () => {
    expect(resetPasswordSchema.safeParse({ token: '', newPassword: 'longenough' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: 'short' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 'abc', newPassword: 'longenough' }).success).toBe(true);
  });
});
