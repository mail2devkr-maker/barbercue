import { chooseShopHome } from '../shop-home';

// One rule for web and Android: LOGIN -> authorised shop selection -> that shop's dashboard home.
describe('chooseShopHome', () => {
  const shops = (...ids: string[]) => ids.map((id) => ({ id }));

  it('opens the only shop directly, whatever was remembered', () => {
    expect(chooseShopHome(shops('a'), null)).toBe('a');
    expect(chooseShopHome(shops('a'), 'zzz')).toBe('a');
    expect(chooseShopHome(shops('a'), undefined)).toBe('a');
  });

  it('restores the last shop when the server still lists it', () => {
    expect(chooseShopHome(shops('a', 'b', 'c'), 'b')).toBe('b');
  });

  it('asks the user to choose (null) when the remembered shop is gone, unknown or was never set', () => {
    expect(chooseShopHome(shops('a', 'b'), null)).toBeNull();
    expect(chooseShopHome(shops('a', 'b'), undefined)).toBeNull();
    expect(chooseShopHome(shops('a', 'b'), 'removed')).toBeNull();
  });

  it('never invents a shop for a user who has none', () => {
    expect(chooseShopHome([], 'a')).toBeNull();
    expect(chooseShopHome([], null)).toBeNull();
  });

  it('never selects a shop outside the authorised list', () => {
    expect(chooseShopHome(shops('a', 'b'), 'someone-elses')).toBeNull();
  });
});
