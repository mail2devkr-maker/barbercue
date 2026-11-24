import { resolve, sep } from 'node:path';
import { LocalPrivateStorageDriver } from './private-object-storage.service';

describe('private storage volume fallback', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const set = (mount?: string) => {
    delete process.env.PRIVATE_STORAGE_DIR;
    delete process.env.OBJECT_STORAGE_PRIVATE_BUCKET;
    if (mount) process.env.RAILWAY_VOLUME_MOUNT_PATH = mount;
    else delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  };

  it('is off without a volume', () => {
    set();
    expect(LocalPrivateStorageDriver.volumeDir('/data/uploads')).toBeUndefined();
    expect(LocalPrivateStorageDriver.fromEnv()).toBeNull();
  });

  it('uses a sibling of the public folder, never inside it', () => {
    set('/data');
    const dir = LocalPrivateStorageDriver.volumeDir('/data/uploads')!;
    expect(dir).toBe(resolve('/data/private-files'));
    expect(dir.startsWith(resolve('/data/uploads') + sep)).toBe(false);
  });

  it('uses an unserved dot-folder when photos occupy the whole volume', () => {
    set('/data');
    expect(LocalPrivateStorageDriver.volumeDir('/data')).toBe(
      resolve('/data/.private-files'),
    );
  });

  it('still refuses an explicit private folder inside the public one', () => {
    set('/data');
    process.env.LOCAL_STORAGE_DIR = '/data';
    process.env.PRIVATE_STORAGE_DIR = '/data/private';
    expect(LocalPrivateStorageDriver.fromEnv()).toBeNull();
  });
});
