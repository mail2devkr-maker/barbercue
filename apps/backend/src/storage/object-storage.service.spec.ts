import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectStorageService } from './object-storage.service';

const LOCAL_VARS = ['LOCAL_STORAGE_DIR', 'LOCAL_STORAGE_PUBLIC_BASE_URL'];
const S3_VARS = [
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_KEY',
  'OBJECT_STORAGE_SECRET',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_PUBLIC_BASE_URL',
];
const ALL_VARS = [...LOCAL_VARS, ...S3_VARS, 'STORAGE_DRIVER'];

function setValidS3Vars(): void {
  process.env.OBJECT_STORAGE_BUCKET = 'some-bucket';
  process.env.OBJECT_STORAGE_KEY = 'key';
  process.env.OBJECT_STORAGE_SECRET = 'secret';
  process.env.OBJECT_STORAGE_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
  process.env.OBJECT_STORAGE_PUBLIC_BASE_URL = 'https://pub.example.com';
}

describe('ObjectStorageService driver selection', () => {
  let dir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'barbercue-photos-'));
    for (const v of ALL_VARS) {
      originalEnv[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(async () => {
    for (const v of ALL_VARS) {
      if (originalEnv[v] === undefined) delete process.env[v];
      else process.env[v] = originalEnv[v];
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('is unconfigured when neither the local volume nor S3 vars are set', async () => {
    const service = new ObjectStorageService();
    expect(service.isConfigured).toBe(false);
    await expect(
      service.putPublicObject('k', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  });

  // The launch driver: a Railway Volume mount, simulated here by a temp directory.
  it('selects the local-disk driver when LOCAL_STORAGE_* is set, even if S3 vars are also present', async () => {
    process.env.LOCAL_STORAGE_DIR = dir;
    process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = 'http://localhost:3000';
    // Deliberately also set S3 vars to prove local disk is checked first per the documented
    // selection order — a stray leftover R2 credential must never silently take over.
    process.env.OBJECT_STORAGE_BUCKET = 'some-bucket';
    process.env.OBJECT_STORAGE_KEY = 'key';
    process.env.OBJECT_STORAGE_SECRET = 'secret';
    process.env.OBJECT_STORAGE_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.OBJECT_STORAGE_PUBLIC_BASE_URL = 'https://pub.example.com';

    const service = new ObjectStorageService();
    expect(service.isConfigured).toBe(true);
    const url = await service.putPublicObject('salons/s1/photos/a.jpg', Buffer.from('x'), 'image/jpeg');
    expect(url).toBe('http://localhost:3000/uploads/salons/s1/photos/a.jpg');
  });

  it('never constructs an S3 client from a partial credential set', () => {
    process.env.OBJECT_STORAGE_BUCKET = 'some-bucket';
    process.env.OBJECT_STORAGE_KEY = 'key';
    // secret/endpoint/publicBaseUrl deliberately left unset.
    const service = new ObjectStorageService();
    expect(service.isConfigured).toBe(false);
  });

  describe('explicit STORAGE_DRIVER selector', () => {
    // Proves the *selection*, not the S3 driver's own network behavior (untested here — it would
    // require a real or mocked R2 endpoint, which is out of scope for a driver-selection test):
    // configured with valid R2 credentials plus a fully-valid local volume, isConfigured is true
    // and putPublicObject actually reaches the S3 driver rather than local disk (proven by the
    // attempt failing on a network call to the fake example.com endpoint, not by writing to `dir`).
    it('STORAGE_DRIVER=r2 selects S3 even when LOCAL_STORAGE_* is also set — an explicit choice must never be silently overridden by a stray local volume', async () => {
      process.env.STORAGE_DRIVER = 'r2';
      setValidS3Vars();
      process.env.LOCAL_STORAGE_DIR = dir;
      process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = 'http://localhost:3000';

      const service = new ObjectStorageService();
      expect(service.isConfigured).toBe(true);
      await expect(
        service.putPublicObject('salons/s1/photos/a.jpg', Buffer.from('x'), 'image/jpeg'),
      ).rejects.toMatchObject({ code: 'PHOTO_UPLOAD_FAILED' }); // network call to the fake R2 endpoint fails — proves it never touched `dir`
      const localFilesWritten = await readdir(dir).catch(() => []);
      expect(localFilesWritten).toEqual([]);
    });

    it('STORAGE_DRIVER=r2 with a missing OBJECT_STORAGE_* variable stays unconfigured rather than falling back to local, even if local is fully configured', async () => {
      process.env.STORAGE_DRIVER = 'r2';
      setValidS3Vars();
      delete process.env.OBJECT_STORAGE_SECRET; // one required var missing
      process.env.LOCAL_STORAGE_DIR = dir;
      process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = 'http://localhost:3000';

      const service = new ObjectStorageService();
      expect(service.isConfigured).toBe(false);
      await expect(
        service.putPublicObject('k', Buffer.from('x'), 'image/jpeg'),
      ).rejects.toMatchObject({ code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
    });

    it('STORAGE_DRIVER=local selects local disk even when OBJECT_STORAGE_* vars are also present', async () => {
      process.env.STORAGE_DRIVER = 'local';
      process.env.LOCAL_STORAGE_DIR = dir;
      process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = 'http://localhost:3000';
      setValidS3Vars();

      const service = new ObjectStorageService();
      expect(service.isConfigured).toBe(true);
      const url = await service.putPublicObject('salons/s1/photos/a.jpg', Buffer.from('x'), 'image/jpeg');
      expect(url).toBe('http://localhost:3000/uploads/salons/s1/photos/a.jpg');
    });

    it('STORAGE_DRIVER=local without local vars stays unconfigured, ignoring valid S3 vars', () => {
      process.env.STORAGE_DRIVER = 'local';
      setValidS3Vars();

      const service = new ObjectStorageService();
      expect(service.isConfigured).toBe(false);
    });

    it('an unrecognized STORAGE_DRIVER value leaves storage unconfigured', () => {
      process.env.STORAGE_DRIVER = 'dropbox';
      process.env.LOCAL_STORAGE_DIR = dir;
      process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = 'http://localhost:3000';

      const service = new ObjectStorageService();
      expect(service.isConfigured).toBe(false);
    });
  });
});
