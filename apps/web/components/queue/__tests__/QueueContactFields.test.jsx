import { CONTACT_NAME_ERROR, CONTACT_PHONE_ERROR, resolveContactInput } from '../QueueContactFields';

// Both web join flows (signed-in walk-in and the public QR page) validate through this one function
// before POSTing, so an uncontactable / unnamed entry can never be created from the web.
describe('resolveContactInput', () => {
  it('normalizes a valid name and Indian mobile number to the join payload', () => {
    expect(resolveContactInput('  Ravi   Kumar ', '98111 22233')).toEqual({
      ok: true,
      contact: { contactName: 'Ravi Kumar', contactPhone: '+919811122233' },
    });
  });

  it('accepts an explicit international number', () => {
    expect(resolveContactInput('Sam', '+14155552671')).toEqual({
      ok: true,
      contact: { contactName: 'Sam', contactPhone: '+14155552671' },
    });
  });

  it('refuses a missing name', () => {
    expect(resolveContactInput('', '9811122233')).toEqual({ ok: false, error: CONTACT_NAME_ERROR });
    expect(resolveContactInput(' A ', '9811122233')).toEqual({ ok: false, error: CONTACT_NAME_ERROR });
  });

  it('refuses a missing or invalid mobile number, so nobody joins uncontactable', () => {
    expect(resolveContactInput('Ravi', '')).toEqual({ ok: false, error: CONTACT_PHONE_ERROR });
    expect(resolveContactInput('Ravi', '12345')).toEqual({ ok: false, error: CONTACT_PHONE_ERROR });
  });

  it('checks the name first, then the phone', () => {
    expect(resolveContactInput('', '')).toEqual({ ok: false, error: CONTACT_NAME_ERROR });
  });
});
