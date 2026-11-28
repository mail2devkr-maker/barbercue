import {
  Role,
  VI_ROLE_CAPABILITIES,
  classifyViChannel,
  normalizeViSearch,
  parseViUserAgent,
  redactSensitiveText,
  referrerDomain,
  resolveViRange,
  sanitizeViProps,
  scoreViOpportunity,
  viCapabilitiesFor,
  viCollectSchema,
  viKpi,
} from '..';

describe('visitor intelligence: redaction', () => {
  it.each([
    ['haircut near me', 'haircut near me', false],
    ['facial call 9876543210', 'facial call', true],
    ['bridal makeup me@example.com', 'bridal makeup', true],
    ['card 4111 1111 1111 1111 spa', 'card spa', true],
    ['my password is hunter2', 'my', true],
    ['pay to name@okhdfc keratin', 'pay to keratin', true],
    ['ABCDE1234F pan', 'pan', true],
  ])('%s', (input, expected, redacted) => {
    const r = redactSensitiveText(input);
    expect(r.text).toBe(expected);
    expect(r.redacted).toBe(redacted);
  });

  it('drops unknown props, rounds coordinates and redacts free text', () => {
    const out = sanitizeViProps({ query: 'beard trim 9999988888', email: 'x@y.com', lat: 22.719568, lng: 75.857727, resultCount: 4, nested: { a: 1 } });
    expect(out).toEqual({ query: 'beard trim', lat: 22.72, lng: 75.858, resultCount: 4 });
  });
});

describe('visitor intelligence: search normalisation', () => {
  it.each([
    ['Hair Cutting', 'haircut'],
    ['hair trimming', 'haircut'],
    ['haircut', 'haircut'],
    ['facial', 'facial'],
    ['face treatment', 'facial'],
    ['beard grooming', 'beard-trim'],
    ['beard trim', 'beard-trim'],
    ['Wedding Makeup', 'bridal-makeup'],
    ['bridal makeup', 'bridal-makeup'],
  ])('%s → %s', (q, category) => {
    const n = normalizeViSearch(q);
    expect(n.category).toBe(category);
    expect(n.original).toBe(q);
  });

  it('keeps unknown keywords without inventing a category', () => {
    expect(normalizeViSearch('tattoo studio').category).toBeNull();
  });
});

describe('visitor intelligence: channels', () => {
  it.each([
    [{ utmSource: 'google', utmMedium: 'cpc' }, 'GOOGLE_ADS'],
    [{ gclid: true }, 'GOOGLE_ADS'],
    [{ utmSource: 'facebook', utmMedium: 'paid_social' }, 'META_ADS'],
    [{ utmSource: 'instagram', utmMedium: 'social' }, 'INSTAGRAM'],
    [{ referrerDomain: 'l.instagram.com' }, 'INSTAGRAM'],
    [{ referrerDomain: 'google.co.in' }, 'GOOGLE_ORGANIC'],
    [{ referrerDomain: 'wa.me' }, 'WHATSAPP'],
    [{ referrerDomain: 'youtube.com' }, 'YOUTUBE'],
    [{ utmMedium: 'email', utmSource: 'newsletter' }, 'EMAIL'],
    [{ utmMedium: 'sms', utmSource: 'msg91' }, 'SMS'],
    [{ campaignKind: 'SALON_QR' as const }, 'SALON_QR'],
    [{ campaignKind: 'EMPLOYEE_QR' as const }, 'FIELD_SALES'],
    [{ campaignKind: 'INFLUENCER' as const }, 'INFLUENCER'],
    [{ referrerDomain: 'justdial.com' }, 'REFERRAL'],
    [{}, 'DIRECT'],
  ])('%j → %s', (input, channel) => {
    expect(classifyViChannel(input)).toBe(channel);
  });

  it('treats our own domain as no referrer', () => {
    expect(referrerDomain('https://www.fastque.com/search', ['fastque.com'])).toBeNull();
    expect(referrerDomain('https://www.google.com/', ['fastque.com'])).toBe('google.com');
    expect(referrerDomain('not a url')).toBeNull();
  });
});

describe('visitor intelligence: user agent', () => {
  it('detects devices and bots without storing the raw string', () => {
    expect(parseViUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36')).toMatchObject({ device: 'mobile', os: 'Android', browser: 'Chrome', bot: false });
    expect(parseViUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1').device).toBe('tablet');
    expect(parseViUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/126').browser).toBe('Edge');
    expect(parseViUserAgent('Googlebot/2.1 (+http://www.google.com/bot.html)').bot).toBe(true);
    expect(parseViUserAgent('HeadlessChrome/120').bot).toBe(true);
    expect(parseViUserAgent('').bot).toBe(true);
  });
});

describe('visitor intelligence: periods', () => {
  const now = new Date('2026-11-25T10:00:00Z'); // 15:30 IST

  it('today is the IST calendar day and the previous period has equal length', () => {
    const r = resolveViRange('today', now);
    expect(r.from.toISOString()).toBe('2026-11-24T18:30:00.000Z');
    expect(r.to.toISOString()).toBe('2026-11-25T18:30:00.000Z');
    expect(r.previousTo.getTime()).toBe(r.from.getTime());
    expect(r.to.getTime() - r.from.getTime()).toBe(r.previousTo.getTime() - r.previousFrom.getTime());
  });

  it('7d covers seven IST days including today', () => {
    const r = resolveViRange('7d', now);
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(7);
  });

  it('custom ranges are inclusive of the end date and capped at two years', () => {
    const r = resolveViRange('custom', now, { from: '2026-11-01', to: '2026-11-03' });
    expect(r.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(3);
    const long = resolveViRange('custom', now, { from: '2020-01-01', to: '2026-11-01' });
    expect((long.to.getTime() - long.from.getTime()) / 86_400_000).toBeLessThanOrEqual(731);
  });

  it('kpi change is null when there is nothing to compare', () => {
    expect(viKpi(10, 0).changePct).toBeNull();
    expect(viKpi(15, 10).changePct).toBe(50);
  });
});

describe('visitor intelligence: opportunity score', () => {
  it('scores unserved demand high and saturated cities low', () => {
    expect(scoreViOpportunity({ visitors: 200, searches: 120, activeSalons: 1 }).level).toBe('HIGH');
    expect(scoreViOpportunity({ visitors: 0, searches: 25, activeSalons: 0 }).level).toBe('HIGH');
    expect(scoreViOpportunity({ visitors: 40, searches: 20, activeSalons: 2 }).level).toBe('MEDIUM');
    expect(scoreViOpportunity({ visitors: 40, searches: 20, activeSalons: 30 }).level).toBe('LOW');
  });
});

describe('visitor intelligence: roles', () => {
  it('maps existing roles without inventing new Role values', () => {
    expect(viCapabilitiesFor([Role.PLATFORM_ADMIN]).has('integrations')).toBe(true);
    expect(viCapabilitiesFor([Role.PLATFORM_VIEWER]).has('pii')).toBe(false);
    expect(viCapabilitiesFor([Role.CO_FOUNDER]).has('integrations')).toBe(false);
    expect(viCapabilitiesFor([Role.SALES_ADMIN]).has('assignOpportunity')).toBe(true);
    expect(viCapabilitiesFor([Role.SALES_ADMIN]).has('history')).toBe(false);
    expect(viCapabilitiesFor(['SUPPORT']).has('timeline')).toBe(true);
    expect(viCapabilitiesFor(['SUPPORT']).has('export')).toBe(false);
    expect(viCapabilitiesFor([Role.CUSTOMER]).size).toBe(0);
    expect(VI_ROLE_CAPABILITIES[Role.SALON_OWNER]).toEqual([]);
  });
});

describe('visitor intelligence: collect schema', () => {
  const base = {
    visitorId: '6f1c4f6e-1f7c-4a63-9a43-2b0c3e8c9d11',
    sessionId: '7f1c4f6e-1f7c-4a63-9a43-2b0c3e8c9d12',
    consent: { analytics: true, marketing: false },
    context: {},
    events: [{ id: '8f1c4f6e-1f7c-4a63-9a43-2b0c3e8c9d13', type: 'page_view', ts: Date.now(), path: '/' }],
  };
  it('accepts a minimal batch', () => expect(viCollectSchema.safeParse(base).success).toBe(true));
  it('rejects unknown event types and oversized batches', () => {
    expect(viCollectSchema.safeParse({ ...base, events: [{ ...base.events[0], type: 'keystroke' }] }).success).toBe(false);
    expect(viCollectSchema.safeParse({ ...base, events: Array(51).fill(base.events[0]) }).success).toBe(false);
  });
});
