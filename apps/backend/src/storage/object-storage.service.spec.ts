import { mkdtemp, rm } from 'node:fs/promises';
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

describe('ObjectStorageService driver selection', () => {
  let dir: string;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'barbercue-photos-'));
    for (const v of [...LOCAL_VARS, ...S3_VARS]) {
      originalEnv[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(async () => {
    for (const v of [...LOCAL_VARS, ...S3_VARS]) {
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
});
