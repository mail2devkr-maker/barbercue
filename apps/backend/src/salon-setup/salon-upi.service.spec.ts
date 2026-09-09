import QRCode from 'qrcode';
import sharp from 'sharp';
import { SalonPaymentQrService } from './salon-payment-qr.service';
import { BookingPaymentInfoService } from '../bookings/booking-payment-info.service';
import { decodePaymentQr } from './payment-qr-decoder';
import { buildBookingUpiUri, BookingStatus, setSalonUpiSchema } from '@barbercue/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

jest.setTimeout(20000);
const payload = 'upi://pay?pa=merchant%40bank&pn=Shop%20%26%20Sons&am=9999.00';
async function image(text = payload, format: 'png' | 'jpeg' | 'webp' = 'png') {
  // Fix the QR mask for deterministic fixtures; avoid the generator's eight-mask search in Jest's VM.
  const png = await QRCode.toBuffer(text, { width: 600, margin: 4, errorCorrectionLevel: 'M', maskPattern: 0 });
  const buffer = await sharp(png).toFormat(format).toBuffer();
  return { buffer, size: buffer.length, mimetype: `image/${format}`, originalname: `qr.${format}` } as Express.Multer.File;
}

describe('QR-derived UPI — real image decode and replacement safety', () => {
  let row: any; let actor: jest.Mock; let prisma: any; let storage: any;
  let service: SalonPaymentQrService; let info: BookingPaymentInfoService;
  beforeEach(() => {
    row = { paymentQrImageUrl: 'https://cdn.example/legacy.png', upiVpa: 'old@bank', upiPayeeName: 'Old Shop', prepaymentRequirement: 'NONE' };
    actor = jest.fn().mockResolvedValue('OWNER');
    prisma = {
      salonPaymentPolicy: {
        findUnique: jest.fn(async () => row && { ...row }),
        upsert: jest.fn(async ({ create, update }) => { row = row ? { ...row, ...update } : create; return { ...row }; }),
        update: jest.fn(async ({ data }) => { row = { ...row, ...data }; return { ...row }; }),
      },
      auditLog: { create: jest.fn() },
      city: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'IN' }) },
    };
    storage = { putPublicObject: jest.fn(async (key) => `https://cdn.example/${key}`), deleteObject: jest.fn() };
    service = new SalonPaymentQrService(prisma, { assertOwnerOrAdminAccess: actor } as never, storage);
    info = new BookingPaymentInfoService(prisma, { getSalonOrThrow: async () => ({ currency: null, cityId: 'c' }) } as never);
  });
  it.each(['png', 'jpeg', 'webp'] as const)('decodes real %s QR, extracts routing, ignores QR amount', async (format) => {
    const result = await service.setFromUpload('owner', 's', await image(payload, format));
    expect(result).toMatchObject({ upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons', upiQrDecoded: true });
    expect(storage.putPublicObject.mock.calls[0][0]).toContain('/payment-qr/upi-v1/');
    const uri = buildBookingUpiUri({ id: 'booking1', status: BookingStatus.CONFIRMED, payableAmount: 419.25 },
      await info.get('s'), '12345678-1234-4567-8910-123456789012');
    expect(new URL(uri!).searchParams.get('am')).toBe('419.25'); expect(row.am).toBeUndefined();
    expect(prisma.salonPaymentPolicy.upsert.mock.calls[0][0].update).toEqual({
      paymentQrImageUrl: result.paymentQrImageUrl, upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons',
    });
  });
  it('replacement binds NEW QR and NEW account atomically', async () => {
    await service.setFromUpload('owner', 's', await image()); const first = row.paymentQrImageUrl;
    await service.setFromUpload('owner', 's', await image('upi://pay?pa=new@bank&pn=New%20Shop'));
    expect(row.paymentQrImageUrl).not.toBe(first);
    expect(await info.get('s')).toMatchObject({ upiVpa: 'new@bank', upiPayeeName: 'New Shop', upiQrDecoded: true });
  });
  it.each(['https://example.com', 'upi://pay?pa=bad@@bank&pn=Shop', 'upi://pay?pa=merchant@bank'])('non-UPI/malformed replacement clears OLD routing: %s', async (text) => {
    await service.setFromUpload('owner', 's', await image());
    const result = await service.setFromUpload('owner', 's', await image(text));
    expect(result).toMatchObject({ upiVpa: null, upiPayeeName: null, upiQrDecoded: false });
    expect(row).toMatchObject({ upiVpa: null, upiPayeeName: null });
    expect(await info.get('s')).toMatchObject({ onlinePaymentAvailable: true, upiVpa: null, upiQrDecoded: false });
  });
  it('image without QR remains QR-only and clears stale routing', async () => {
    const buffer = await sharp({ create: { width: 100, height: 100, channels: 3, background: 'white' } }).png().toBuffer();
    const result = await service.setFromUpload('owner', 's', { buffer, size: buffer.length } as Express.Multer.File);
    expect(result.upiQrDecoded).toBe(false); expect(row.upiVpa).toBeNull();
  });
  it('delete clears routing even for a legacy row with no QR', async () => {
    await service.remove('owner', 's');
    expect(row).toMatchObject({ paymentQrImageUrl: null, upiVpa: null, upiPayeeName: null });
    row.upiVpa = 'legacy@bank'; row.upiPayeeName = 'Legacy';
    await service.remove('owner', 's'); expect(row.upiVpa).toBeNull();
    expect(await info.get('s')).toMatchObject({ onlinePaymentAvailable: false, upiQrDecoded: false });
  });
  it('linking even a decoded object clears routing without ANY remote fetch', async () => {
    await service.setFromUpload('owner', 's', await image()); const putCount = storage.putPublicObject.mock.calls.length;
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      const result = await service.setLink('owner', 's', { url: row.paymentQrImageUrl });
      expect(result).toMatchObject({ upiVpa: null, upiPayeeName: null, upiQrDecoded: false });
      expect(storage.putPublicObject).toHaveBeenCalledTimes(putCount); expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
  it('old manual values are not advertised as decoded; QR-only legacy stays usable', async () => {
    expect(await service.get('owner', 's')).toMatchObject({ upiVpa: null, upiQrDecoded: false });
    expect(await info.get('s')).toMatchObject({ onlinePaymentAvailable: true, upiVpa: null, upiQrDecoded: false });
    expect(row.upiVpa).toBe('old@bank'); // Reads do not migrate historical data.
  });
  it('legacy client cannot override extracted account via manual PATCH', async () => {
    await service.setFromUpload('owner', 's', await image());
    await expect(service.setUpi('owner', 's', { upiVpa: 'other@bank', upiPayeeName: 'Other' })).rejects.toMatchObject({ code: 'UPI_QR_UPLOAD_REQUIRED' });
    expect(row.upiVpa).toBe('merchant@bank');
  });
  it.each(['missing-at', 'two@@bank', 'space me@bank', 'bad@bank?am=1', 'bad/@bank', '@bank'])('keeps HTTP VPA validation: %s', (upiVpa) => {
    expect(() => new ZodValidationPipe(setSalonUpiSchema).transform({ upiVpa, upiPayeeName: 'Shop' }, { type: 'body' })).toThrow();
  });
  it('denied actors cannot upload/link/delete/override/store', async () => {
    actor.mockRejectedValue(new Error('denied'));
    await expect(service.setFromUpload('other', 's', undefined)).rejects.toThrow('denied');
    await expect(service.setLink('other', 's', { url: 'https://example.com' })).rejects.toThrow('denied');
    await expect(service.remove('other', 's')).rejects.toThrow('denied');
    await expect(service.setUpi('other', 's', { upiVpa: null, upiPayeeName: null })).rejects.toThrow('denied');
    expect(storage.putPublicObject).not.toHaveBeenCalled(); expect(prisma.salonPaymentPolicy.upsert).not.toHaveBeenCalled();
  });
  it('delegated admin audit remains free of QR payload/image bytes', async () => {
    actor.mockResolvedValue('PLATFORM_ADMIN'); await service.setFromUpload('admin', 's', await image());
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'admin', action: 'ADMIN_PAYMENT_QR_UPDATED' }) });
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain('merchant');
  });
  it('storage failure preserves entire previous QR/account pair', async () => {
    const before = { ...row }; storage.putPublicObject.mockRejectedValue(new Error('storage down'));
    await expect(service.setFromUpload('owner', 's', await image())).rejects.toThrow('storage down');
    expect(row).toEqual(before); expect(prisma.salonPaymentPolicy.upsert).not.toHaveBeenCalled();
  });
  it('malformed image bytes fail closed without throwing', async () => {
    expect(await decodePaymentQr(Buffer.from('not an image'))).toBeNull();
  });
  it('non-INR salon never silently uses INR', async () => {
    const other = new BookingPaymentInfoService(prisma, { getSalonOrThrow: async () => ({ currency: 'GBP' }) } as never);
    expect((await other.get('s')).currency).toBe('GBP');
  });
});
