const { parseOnboardingServices, suggestOnboardingCounts } = require('../employee-voice-parser');

describe('employee voice onboarding: conservative transcription hints', () => {
  test('extracts multiple Hindi-English numeric service prices', () => {
    expect(parseOnboardingServices('Haircut 150 rupees, beard 80, head massage 200.')).toEqual([
      { name: 'Haircut', priceInr: 150 },
      { name: 'Beard trim', priceInr: 80 },
      { name: 'Head massage', priceInr: 200 },
    ]);
  });

  test('understands Devanagari service names and digits without inferring unspoken prices', () => {
    expect(parseOnboardingServices('कटिंग १५० रुपये, दाढ़ी ८० रुपये, मसाज २००')).toEqual([
      { name: 'Haircut', priceInr: 150 },
      { name: 'Beard trim', priceInr: 80 },
      { name: 'Massage', priceInr: 200 },
    ]);
    expect(parseOnboardingServices('कटिंग सौ रुपये')).toEqual([]);
  });

  test('never treats a phone number or unlabelled amounts as service prices', () => {
    expect(parseOnboardingServices('Phone 9876543210. Address Patna. Fee 500.')).toEqual([]);
    expect(parseOnboardingServices('Haircut available, ask owner for price.')).toEqual([]);
    expect(parseOnboardingServices('Haircut 9999999')).toEqual([]);
  });

  test('suggests explicit chair/staff counts only when numeric', () => {
    expect(suggestOnboardingCounts('chairs 4 staff 3')).toEqual({ chairCount: 4, staffCount: 3 });
    expect(suggestOnboardingCounts('चेयर ४ स्टाफ ३')).toEqual({ chairCount: 4, staffCount: 3 });
    expect(suggestOnboardingCounts('chairs are many and staff are good')).toEqual({});
  });
});
