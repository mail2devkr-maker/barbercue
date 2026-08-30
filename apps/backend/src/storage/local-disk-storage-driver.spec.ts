import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inspectLocalStorageConfig,
  LocalDiskStorageDriver,
  LOCAL_STORAGE_URL_PREFIX,
} from './local-disk-storage-driver';

describe('LocalDiskStorageDriver', () => {
  let dir: string;
  const ORIGIN = 'http://localhost:3000';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'barbercue-photos-'));
    process.env.LOCAL_STORAGE_DIR = dir;
    process.env.LOCAL_STORAGE_PUBLIC_BASE_URL = ORIGIN;
  });

  afterEach(async () => {
    delete process.env.LOCAL_STORAGE_DIR;
    delete process.env.LOCAL_STORAGE_PUBLIC_BASE_URL;
    await rm(dir, { recursive: true, force: true });
  });

  it('is null unless both env vars are set', () => {
    delete process.env.LOCAL_STORAGE_DIR;
    expect(LocalDiskStorageDriver.fromEnv()).toBeNull();
    process.env.LOCAL_STORAGE_DIR = dir;
    delete process.env.LOCAL_STORAGE_PUBLIC_BASE_URL;
    expect(LocalDiskStorageDriver.fromEnv()).toBeNull();
  });

  it('reports whether the configured volume contains salon directories without exposing names', async () => {
    await mkdir(join(dir, 'salons', 'salon-a'), { recursive: true });
    await mkdir(join(dir, 'salons', 'salon-b'), { recursive: true });
    expect(inspectLocalStorageConfig()).toEqual({
      directoryConfigured: true,
      publicBaseConfigured: true,
      directoryExists: true,
      salonsDirectoryExists: true,
      salonDirectoryCount: 2,
    });
  });

  it('writes the file under the configured directory and returns a URL under the shared prefix', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    const url = await driver.putPublicObject(
      'salons/s1/photos/a.jpg',
      Buffer.from('fake-jpeg-bytes'),
      'image/jpeg',
    );
    expect(url).toBe(`${ORIGIN}${LOCAL_STORAGE_URL_PREFIX}/salons/s1/photos/a.jpg`);
    const onDisk = await readFile(join(dir, 'salons', 's1', 'photos', 'a.jpg'));
    expect(onDisk.toString()).toBe('fake-jpeg-bytes');
  });

  it('creates nested directories that do not exist yet', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    await driver.putPublicObject('salons/new-salon/photos/first.png', Buffer.from('x'), 'image/png');
    const stats = await stat(join(dir, 'salons', 'new-salon', 'photos', 'first.png'));
    expect(stats.isFile()).toBe(true);
  });

  it('refuses a key that would escape the storage directory', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    await expect(
      driver.putPublicObject('../../etc/passwd', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toThrow(/outside the storage directory/);
  });

  it('deletes the file a previously-returned URL points at', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    const url = await driver.putPublicObject('salons/s1/photos/gone.jpg', Buffer.from('x'), 'image/jpeg');
    await driver.deleteObject(url);
    await expect(stat(join(dir, 'salons', 's1', 'photos', 'gone.jpg'))).rejects.toThrow();
  });

  it('leaves a URL that does not belong to this driver untouched', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    await driver.putPublicObject('salons/s1/photos/keep.jpg', Buffer.from('x'), 'image/jpeg');
    // An owner-linked photo hosted elsewhere — must never be treated as ours to delete.
    await driver.deleteObject('https://cdn.example.com/some/other/photo.jpg');
    const stats = await stat(join(dir, 'salons', 's1', 'photos', 'keep.jpg'));
    expect(stats.isFile()).toBe(true);
  });

  it('does not throw when asked to delete a file that is already gone', async () => {
    const driver = LocalDiskStorageDriver.fromEnv()!;
    await expect(
      driver.deleteObject(`${ORIGIN}${LOCAL_STORAGE_URL_PREFIX}/salons/s1/photos/never-existed.jpg`),
    ).resolves.toBeUndefined();
  });
});
