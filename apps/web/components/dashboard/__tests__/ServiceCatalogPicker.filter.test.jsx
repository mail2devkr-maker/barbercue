import { SERVICE_CATALOG } from '@barbercue/shared';
import { serviceMatchesCatalogQuery } from '../ServiceCatalogPicker';

function catalogItem(id) {
  const item = SERVICE_CATALOG.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing catalog fixture: ${id}`);
  return item;
}

describe('service catalog search filtering', () => {
  it('matches the service name, not the category text', () => {
    expect(serviceMatchesCatalogQuery(catalogItem('classic-haircut'), 'Hair')).toBe(true);

    // "Skin Fade" belongs to "Men's Hair & Grooming", but its service name does not contain Hair.
    // The separate Category selector owns category filtering, so this must stay hidden.
    expect(serviceMatchesCatalogQuery(catalogItem('skin-fade'), 'Hair')).toBe(false);
  });

  it('normalizes spaces, punctuation and case for service-name matching', () => {
    expect(serviceMatchesCatalogQuery(catalogItem('classic-haircut'), 'hair cut')).toBe(true);
    expect(serviceMatchesCatalogQuery(catalogItem('skin-fade'), 'SKIN-FADE')).toBe(true);
  });

  it('keeps all services visible for a blank search', () => {
    expect(serviceMatchesCatalogQuery(catalogItem('skin-fade'), '   ')).toBe(true);
  });
});
