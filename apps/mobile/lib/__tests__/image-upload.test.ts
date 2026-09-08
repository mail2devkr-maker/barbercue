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
  createImageFormData,
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
    const send = jest.fn(async (bodyFactory: () => FormData) => {
      const form = bodyFactory();
      expect(form).toBeInstanceOf(FormData);
      return { uploaded: true };
    });

    await expect(uploadImageAsset(asset({ uri: 'file:///picked/qr.png' }), 'payment-qr.jpg', {}, send)).resolves.toEqual({ uploaded: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('includes the image part and additional multipart fields without changing server validation', () => {
    const append = jest.spyOn(FormData.prototype, 'append');

    createImageFormData(
      { uri: 'file:///picked/photo.jpg', name: 'photo.jpg', type: 'image/jpeg' },
      { type: 'GALLERY' },
    );

    expect(append).toHaveBeenNthCalledWith(1, 'image', {
      uri: 'file:///picked/photo.jpg',
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
    expect(append).toHaveBeenNthCalledWith(2, 'type', 'GALLERY');
    append.mockRestore();
  });
});
