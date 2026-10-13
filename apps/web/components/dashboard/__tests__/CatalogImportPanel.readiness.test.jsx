import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { CatalogImportPanel } from '../CatalogImportPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

it('warns and refuses a PDF upload when the backend has no OCR provider', async () => {
  apiFetch.mockResolvedValue({ pdfPhotoOcrAvailable: false });
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <CatalogImportPanel
          basePath="dashboard/salons/s1/services"
          existingServices={[]}
          onImported={async () => {}}
        />
      );
    });
    expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/s1/services/import-capabilities');
    const renderedText = JSON.stringify(renderer.toJSON());
    expect(renderedText).toContain('PDF/photo extraction is unavailable');
    const input = renderer.root.findByProps({ id: 'catalog-multiple-input' });
    await act(async () => input.props.onChange({
      target: { files: [{ name: 'catalog.pdf', size: 1200, lastModified: 1 }] },
    }));
    expect(renderer.root.findAllByType('li')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('PDF/photo extraction is not configured yet');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
