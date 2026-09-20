import { SalonType } from '../enums';
import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_PACKS,
  serviceAvailableInPack,
  serviceAvailableForSalonType,
  suggestedServicePriceInr,
  type ServicePackId,
} from '../catalog/service-catalog';

describe('service catalog onboarding packs', () => {
  it('uses a supported minimum tier for every catalog service', () => {
    const valid = new Set<ServicePackId>(['BASIC', 'STANDARD', 'ADVANCED']);
    expect(SERVICE_CATALOG.length).toBeGreaterThan(0);
    for (const service of SERVICE_CATALOG) {
      expect(valid.has(service.pack)).toBe(true);
    }
  });

  it('makes packs nested: Basic is a subset of Standard, Standard is a subset of Advance', () => {
    const basic = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'BASIC'));
    const standard = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'STANDARD'));
    const advanced = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'ADVANCED'));

    expect(basic.length).toBeGreaterThan(0);
    expect(standard.length).toBeGreaterThan(basic.length);
    expect(advanced.length).toBeGreaterThan(standard.length);
    expect(advanced.length).toBe(SERVICE_CATALOG.length);

    for (const service of basic) {
      expect(serviceAvailableInPack(service, 'STANDARD')).toBe(true);
      expect(serviceAvailableInPack(service, 'ADVANCED')).toBe(true);
    }
    for (const service of standard) {
      expect(serviceAvailableInPack(service, 'ADVANCED')).toBe(true);
    }
  });

  it('uses the pack as both service breadth and salon tier', () => {
    const basic = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'BASIC'));
    const standard = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'STANDARD'));
    const advanced = SERVICE_CATALOG.filter((service) => serviceAvailableInPack(service, 'ADVANCED'));

    // Unisex sees the combined catalogue: essential gents + ladies at Basic, more at Standard,
    // and all beauty services at Advance.
    expect(basic).toHaveLength(49);
    expect(standard).toHaveLength(109);
    expect(advanced).toHaveLength(145);
    expect(advanced).toHaveLength(SERVICE_CATALOG.length);
  });

  it('filters every pack by Gents, Ladies or Unisex salon type', () => {
    const count = (salonType: SalonType, pack: ServicePackId) =>
      SERVICE_CATALOG.filter(
        (service) =>
          serviceAvailableInPack(service, pack) &&
          serviceAvailableForSalonType(service, salonType),
      ).length;

    expect({
      gents: [count(SalonType.GENTS, 'BASIC'), count(SalonType.GENTS, 'STANDARD'), count(SalonType.GENTS, 'ADVANCED')],
      ladies: [count(SalonType.LADIES, 'BASIC'), count(SalonType.LADIES, 'STANDARD'), count(SalonType.LADIES, 'ADVANCED')],
      unisex: [count(SalonType.UNISEX, 'BASIC'), count(SalonType.UNISEX, 'STANDARD'), count(SalonType.UNISEX, 'ADVANCED')],
    }).toEqual({
      gents: [21, 53, 67],
      ladies: [28, 56, 80],
      unisex: [49, 109, 145],
    });

    const haircut = SERVICE_CATALOG.find((service) => service.id === 'classic-haircut')!;
    const womensHaircut = SERVICE_CATALOG.find((service) => service.id === 'womens-haircut')!;
    const gentsHeadMassage = SERVICE_CATALOG.find((service) => service.id === 'gents-head-massage')!;
    const ladiesHeadMassage = SERVICE_CATALOG.find((service) => service.id === 'ladies-head-massage')!;

    expect(serviceAvailableForSalonType(haircut, SalonType.GENTS)).toBe(true);
    expect(serviceAvailableForSalonType(haircut, SalonType.LADIES)).toBe(false);
    expect(serviceAvailableForSalonType(womensHaircut, SalonType.LADIES)).toBe(true);
    expect(serviceAvailableForSalonType(womensHaircut, SalonType.GENTS)).toBe(false);
    expect(serviceAvailableForSalonType(gentsHeadMassage, SalonType.GENTS)).toBe(true);
    expect(serviceAvailableForSalonType(gentsHeadMassage, SalonType.LADIES)).toBe(false);
    expect(serviceAvailableForSalonType(ladiesHeadMassage, SalonType.LADIES)).toBe(true);
    expect(serviceAvailableForSalonType(ladiesHeadMassage, SalonType.GENTS)).toBe(false);
    expect(serviceAvailableForSalonType(gentsHeadMassage, SalonType.UNISEX)).toBe(true);
    expect(serviceAvailableForSalonType(ladiesHeadMassage, SalonType.UNISEX)).toBe(true);
    expect(serviceAvailableForSalonType(haircut, SalonType.UNISEX)).toBe(true);
    expect(serviceAvailableForSalonType(womensHaircut, SalonType.UNISEX)).toBe(true);
  });

  it('gives every available service a positive editable price and valid duration', () => {
    const packs: ServicePackId[] = ['BASIC', 'STANDARD', 'ADVANCED'];
    for (const service of SERVICE_CATALOG) {
      for (const pack of packs) {
        if (!serviceAvailableInPack(service, pack)) continue;
        expect(Number.isFinite(suggestedServicePriceInr(service, pack))).toBe(true);
        expect(suggestedServicePriceInr(service, pack)).toBeGreaterThan(0);
      }
      expect(Number.isInteger(service.defaultDurationMinutes)).toBe(true);
      expect(service.defaultDurationMinutes).toBeGreaterThanOrEqual(5);
      expect(service.defaultDurationMinutes).toBeLessThanOrEqual(480);
    }
  });

  it('supports lower Basic, mid Standard and higher Advance prices for shared services', () => {
    const expectations = [
      ['classic-haircut', 50, 100, 200],
      ['beard-trim', 50, 100, 200],
      ['gents-head-massage', 80, 150, 300],
      ['ladies-head-massage', 150, 250, 500],
    ] as const;

    for (const [id, basicPrice, standardPrice, advancedPrice] of expectations) {
      const service = SERVICE_CATALOG.find((candidate) => candidate.id === id);
      expect(service).toBeDefined();
      expect(suggestedServicePriceInr(service!, 'BASIC')).toBe(basicPrice);
      expect(suggestedServicePriceInr(service!, 'STANDARD')).toBe(standardPrice);
      expect(suggestedServicePriceInr(service!, 'ADVANCED')).toBe(advancedPrice);
    }
  });

  it('keeps common Unisex services separate for Gents and Ladies pricing/time', () => {
    const gentsColour = SERVICE_CATALOG.find(
      (service) => service.id === 'gents-global-hair-colour',
    )!;
    const ladiesColour = SERVICE_CATALOG.find(
      (service) => service.id === 'ladies-global-hair-colour',
    )!;
    const gentsSpa = SERVICE_CATALOG.find((service) => service.id === 'gents-hair-spa')!;
    const ladiesSpa = SERVICE_CATALOG.find((service) => service.id === 'ladies-hair-spa')!;

    expect(gentsColour.name).toBe('Gents Global Hair Colour');
    expect(ladiesColour.name).toBe('Ladies Global Hair Colour');
    expect(gentsColour.defaultDurationMinutes).toBe(60);
    expect(ladiesColour.defaultDurationMinutes).toBe(120);
    expect(suggestedServicePriceInr(gentsColour, 'STANDARD')).toBe(500);
    expect(suggestedServicePriceInr(ladiesColour, 'STANDARD')).toBe(1200);

    expect(gentsSpa.defaultDurationMinutes).toBe(45);
    expect(ladiesSpa.defaultDurationMinutes).toBe(60);
    expect(suggestedServicePriceInr(gentsSpa, 'STANDARD')).toBe(500);
    expect(suggestedServicePriceInr(ladiesSpa, 'STANDARD')).toBe(900);

    const ambiguousSharedNames = SERVICE_CATALOG.filter((service) =>
      ['Global Hair Colour', 'Hair Spa', 'Cleanup', 'Head Massage'].includes(service.name),
    );
    expect(ambiguousSharedNames).toHaveLength(0);
  });

  it('uses the owner-requested pack labels', () => {
    expect(SERVICE_CATALOG_PACKS.map((pack) => pack.label)).toEqual([
      'Basic Salon Services',
      'Standard Salon Services',
      'Advance Salon Services',
    ]);
  });
});
