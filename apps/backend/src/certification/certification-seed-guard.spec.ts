import {
  CERT_CONFIRMATION,
  CERT_SALON_SLUG,
  MIGRATION_BOOTSTRAP_EMAIL,
  assertCertificationDatabase,
} from './certification-seed-guard';

const empty = { salonSlugs: [], users: [] };

describe('assertCertificationDatabase (temporary certification seed guard)', () => {
  it('runs on an empty database with the explicit confirmation', () => {
    expect(() => assertCertificationDatabase(CERT_CONFIRMATION, empty)).not.toThrow();
  });

  it('refuses without the typed confirmation, whatever the database holds', () => {
    expect(() => assertCertificationDatabase(undefined, empty)).toThrow(/CERT_SEED_CONFIRM/);
    expect(() => assertCertificationDatabase('yes', empty)).toThrow(/CERT_SEED_CONFIRM/);
  });

  it('allows a re-run on the certification data itself (idempotent)', () => {
    expect(() =>
      assertCertificationDatabase(CERT_CONFIRMATION, {
        salonSlugs: [CERT_SALON_SLUG],
        users: [
          { email: 'cert-owner@cert.fastque.invalid', phone: null },
          { email: 'cert-customer-1@CERT.FASTQUE.INVALID', phone: null },
          { email: MIGRATION_BOOTSTRAP_EMAIL, phone: null },
        ],
      }),
    ).not.toThrow();
  });

  it('REFUSES a database with any real salon - a production database can never pass', () => {
    expect(() =>
      assertCertificationDatabase(CERT_CONFIRMATION, { salonSlugs: [CERT_SALON_SLUG, 'raj-hair-studio'], users: [] }),
    ).toThrow(/non-certification salon/);
  });

  it('REFUSES a database with real customers (phone accounts) or any non-certification email', () => {
    expect(() =>
      assertCertificationDatabase(CERT_CONFIRMATION, { salonSlugs: [], users: [{ email: null, phone: '+919000000001' }] }),
    ).toThrow(/non-certification user/);
    expect(() =>
      assertCertificationDatabase(CERT_CONFIRMATION, { salonSlugs: [], users: [{ email: 'someone@gmail.com', phone: null }] }),
    ).toThrow(/non-certification user/);
    expect(() =>
      assertCertificationDatabase(CERT_CONFIRMATION, {
        salonSlugs: [],
        users: [{ email: 'cert-owner@cert.fastque.invalid', phone: '+919000000009' }],
      }),
    ).toThrow(/non-certification user/);
  });
});
