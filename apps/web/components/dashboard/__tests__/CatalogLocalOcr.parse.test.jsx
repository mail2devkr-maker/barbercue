import { parseCatalogRateText } from '../../../lib/catalog-local-ocr';

describe('keyless OCR review parser', () => {
  it('extracts explicit Hindi, English and rupee-price pairs without inventing durations', () => {
    const entries = parseCatalogRateText(
      'PRICE LIST\nHaircut - ₹150\nBeard : Rs. 80\nहेयर स्पा ₹५००\nFacial 600\nTotal 1330',
      'ratecard.png'
    );
    expect(entries).toHaveLength(4);
    expect(entries.map(x => [x.name, x.price])).toEqual([
      ['Haircut', 150],
      ['Beard', 80],
      ['हेयर स्पा', 500],
      ['Facial', 600],
    ]);
    expect(entries.every(x => x.durationMinutes === null)).toBe(true);
    expect(entries.every(x => x.source === 'ratecard.png')).toBe(true);
  });

  it('only sets a duration when it is printed and rejects hallucinated prices', () => {
    const entries = parseCatalogRateText('Hair Spa - 45 min - ₹300\nFacial\nWelcome to our salon\n30 min haircut');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'Hair Spa', price: 300, durationMinutes: 45 });
  });

  it('parses no services from unreadable OCR output', () => {
    expect(parseCatalogRateText('Appointment only\nCall us for rates\nअनुमानित मूल्य')).toEqual([]);
  });
});
