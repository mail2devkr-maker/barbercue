import { SalonStatus, type SalonShareLinksDto } from '@barbercue/shared';
import { classifySalonShareLinks, createQrMatrix } from '../qr-poster';

function dto(overrides: Partial<SalonShareLinksDto> = {}): SalonShareLinksDto {
  return {
    salonId: 'salon-1',
    status: SalonStatus.ACTIVE,
    publicPath: '/in/hajipur/example',
    publicUrl: 'https://fastque.com/in/hajipur/example',
    readiness: { ready: true, reasons: [] },
    metadata: { title: 'Example Salon', description: null, imageUrl: null },
    ...overrides,
  };
}

describe('salon QR poster', () => {
  it('uses only the canonical HTTPS URL returned for the selected salon', () => {
    expect(classifySalonShareLinks(dto(), 'salon-1')).toEqual({
      kind: 'ready',
      salonName: 'Example Salon',
      publicUrl: 'https://fastque.com/in/hajipur/example',
    });
    expect(classifySalonShareLinks(dto({ salonId: 'other-salon' }), 'salon-1').kind).toBe('unavailable');
    expect(classifySalonShareLinks(dto({ publicUrl: 'http://fastque.com/in/hajipur/example' }), 'salon-1').kind).toBe('unavailable');
  });

  it('does not produce a QR for a shop that is not public or not configured', () => {
    expect(classifySalonShareLinks(dto({ status: SalonStatus.PENDING }), 'salon-1').kind).toBe('not-public');
    expect(classifySalonShareLinks(dto({ readiness: { ready: false, reasons: ['WEB_BASE_URL_NOT_CONFIGURED'] }, publicUrl: null }), 'salon-1').kind).toBe('unavailable');
  });

  it('creates a square native QR preview matrix with a four-module quiet zone', () => {
    const matrix = createQrMatrix('https://fastque.com/in/hajipur/example');
    expect(matrix.cells).toHaveLength(matrix.size * matrix.size);
    expect(matrix.size).toBeGreaterThan(40);
    for (let edge = 0; edge < 4; edge += 1) {
      for (let index = 0; index < matrix.size; index += 1) {
        expect(matrix.cells[edge * matrix.size + index]).toBe(false);
        expect(matrix.cells[(matrix.size - 1 - edge) * matrix.size + index]).toBe(false);
        expect(matrix.cells[index * matrix.size + edge]).toBe(false);
        expect(matrix.cells[index * matrix.size + matrix.size - 1 - edge]).toBe(false);
      }
    }
    expect(matrix.cells.some(Boolean)).toBe(true);
  });
});
