import {
  isValidReviewProfileUrl,
  updateReviewProfilesSchema,
} from '../schemas';

describe('salon external review profile links', () => {
  it.each([
    ['google', 'https://g.page/fastque-shop'],
    ['google', 'https://www.google.com/maps/place/example'],
    ['facebook', 'https://www.facebook.com/fastque.shop'],
    ['facebook', 'https://fb.me/fastque.shop'],
    ['instagram', 'https://www.instagram.com/fastque.shop/'],
  ] as const)('accepts an HTTPS %s profile URL', (provider, url) => {
    expect(isValidReviewProfileUrl(provider, url)).toBe(true);
  });

  it.each([
    ['google', 'http://g.page/fastque-shop'],
    ['google', 'https://google.com.evil.example/maps/place/shop'],
    ['google', 'https://www.google.com/url?url=https://evil.example'],
    ['google', 'https://user:password@g.page/shop'],
    ['google', 'https://g.page:8443/shop'],
    ['facebook', 'https://facebook.com.evil.example/shop'],
    ['instagram', 'https://instagram.com.evil.example/shop'],
  ] as const)('rejects an unsafe or mismatched %s URL', (provider, url) => {
    expect(isValidReviewProfileUrl(provider, url)).toBe(false);
  });

  it('allows partial edits and explicit null clearing, but rejects empty or unknown fields', () => {
    expect(
      updateReviewProfilesSchema.parse({ googleUrl: 'https://g.page/shop' }),
    ).toEqual({ googleUrl: 'https://g.page/shop' });
    expect(updateReviewProfilesSchema.parse({ facebookUrl: null })).toEqual({
      facebookUrl: null,
    });
    expect(updateReviewProfilesSchema.safeParse({}).success).toBe(false);
    expect(
      updateReviewProfilesSchema.safeParse({ googleUrl: null, unknown: true })
        .success,
    ).toBe(false);
  });
});
