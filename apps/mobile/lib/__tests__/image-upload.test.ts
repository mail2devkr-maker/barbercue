jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

import * as FileSystem from 'expo-file-system/legacy';
import {
  IMAGE_UPLOAD_PREPARATION_MESSAGE,
  ImageUploadPreparationError,
  prepareImageUpload,
  uploadImageAsset,
} from '../image-upload';
import type { ImagePickerAsset } from 'expo-image-picker';

const getInfoMock = FileSystem.getInfoAsync as jest.Mock;
const copyMock = FileSystem.copyAsync as jest.Mock;
const deleteMock = FileSystem.deleteAsync as jest.Mock;

function asset(overrides: Partial<ImagePickerAsset> = {}): ImagePickerAsset {
  return {
    uri: 'content://media/external/images/42',
    width: 800,
    height: 600,
    type: 'image',
    fileName: 'payment-qr.png',
    fileSize: 1024,
    mimeType: 'image/png',
    ...overrides,
  };
}

describe('mobile image upload preparation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deleteMock.mockResolvedValue(undefined);
  });

  it('keeps an already-readable file URI and does not rewrite the selected image', async () => {
    getInfoMock.mockResolvedValue({ exists: true, isDirectory: false, size: 1024 });

    const prepared = await prepareImageUpload(asset({ uri: 'file:///picked/qr.png' }), 'payment-qr.jpg');

    expect(prepared).toMatchObject({
      uri: 'file:///picked/qr.png',
      name: 'payment-qr.png',
      type: 'image/png',
    });
    expect(copyMock).not.toHaveBeenCalled();
    await prepared.cleanup();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('copies a content URI to a verified cache file before multipart upload', async () => {
    getInfoMock
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1024 })
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1024 });

    const prepared = await prepareImageUpload(asset(), 'payment-qr.jpg');

    expect(copyMock).toHaveBeenCalledWith({
      from: 'content://media/external/images/42',
      to: expect.stringMatching(/^file:\/\/\/cache\/barbercue-upload-/),
    });
    expect(prepared.uri).toMatch(/^file:\/\/\/cache\/barbercue-upload-/);
    await prepared.cleanup();
    expect(deleteMock).toHaveBeenCalledWith(prepared.uri, { idempotent: true });
  });

  it('turns an inaccessible picker asset into a local preparation error', async () => {
    getInfoMock.mockRejectedValue(new Error('content provider permission denied'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const rejection = prepareImageUpload(asset(), 'payment-qr.jpg');

    await expect(rejection).rejects.toBeInstanceOf(ImageUploadPreparationError);
    await expect(rejection).rejects.toMatchObject({
      code: 'IMAGE_UPLOAD_PREPARATION_FAILED',
      message: IMAGE_UPLOAD_PREPARATION_MESSAGE,
    });
    warnSpy.mockRestore();
  });

  it('rebuilds a fresh multipart body for the upload sender and cleans up afterward', async () => {
    getInfoMock.mockResolvedValue({ exists: true, isDirectory: false, size: 1024 });
    const send = jest.fn(async (prepared: { uri: string; name: string; type: string }) => {
      expect(prepared).toMatchObject({
        uri: 'file:///picked/qr.png',
        name: 'payment-qr.png',
        type: 'image/png',
      });
      return { uploaded: true };
    });

    await expect(uploadImageAsset(asset({ uri: 'file:///picked/qr.png' }), 'payment-qr.jpg', send)).resolves.toEqual({ uploaded: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('cleans a temporary content URI after a native sender failure', async () => {
    getInfoMock
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1024 })
      .mockResolvedValueOnce({ exists: true, isDirectory: false, size: 1024 });
    const send = jest.fn().mockRejectedValue(new Error('native upload failed'));

    await expect(uploadImageAsset(asset(), 'payment-qr.jpg', send)).rejects.toThrow('native upload failed');
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/barbercue-upload-/), { idempotent: true });
  });
});
