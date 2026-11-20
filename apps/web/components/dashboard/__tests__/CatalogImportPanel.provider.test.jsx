import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { CatalogImportPanel } from '../CatalogImportPanel';
import { apiFetch } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../../lib/catalog-local-ocr', () => ({
  extractCatalogLocally: jest.fn(),
  parseCatalogRateText: jest.fn(() => []),
}));

// Node test environment: provide only the window.confirm the panel uses for consent.
const hadWindow = 'window' in globalThis;
beforeAll(() => { if (!hadWindow) globalThis.window = { confirm: () => false }; });
afterAll(() => { if (!hadWindow) delete globalThis.window; });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

async function renderWith(capabilities) {
  apiFetch.mockResolvedValueOnce(capabilities);
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CatalogImportPanel basePath="dashboard/salons/s1/services" existingServices={[]} onImported={async () => {}} />
    );
  });
  // Switch to server extraction.
  const checkbox = renderer.root.findAll((n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  await act(async () => checkbox.props.onChange({ target: { checked: false } }));
  return renderer;
}

async function extract(renderer, file) {
  const input = renderer.root.findByProps({ id: 'catalog-multiple-input' });
  await act(async () => input.props.onChange({ target: { files: [file] } }));
  const button = renderer.root.findAllByType('button').find((node) =>
    typeof node.props.children === 'string' && node.props.children.startsWith('Step 1: Extract'));
  await act(async () => button.props.onClick());
}

it('names the self-hosted model, not Google Gemini, in the consent prompt', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    const renderer = await renderWith({ pdfPhotoOcrAvailable: true, ocrProvider: 'local', ocrPdfSupported: false });
    expect(JSON.stringify(renderer.toJSON())).toContain('self-hosted AI model');
    await extract(renderer, { name: 'menu.jpg', size: 1200, lastModified: 1 });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("FastQue's self-hosted AI model");
    expect(confirm.mock.calls[0][0]).not.toContain('Gemini');
    // Declined: nothing uploaded beyond the capabilities probe.
    expect(apiFetch).toHaveBeenCalledTimes(1);
  } finally {
    confirm.mockRestore();
  }
});

it('blocks PDFs on the local provider before asking for consent or uploading', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    const renderer = await renderWith({ pdfPhotoOcrAvailable: true, ocrProvider: 'local', ocrPdfSupported: false });
    await extract(renderer, { name: 'menu.pdf', size: 1200, lastModified: 1 });
    expect(confirm).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('reads photos only');
  } finally {
    confirm.mockRestore();
  }
});

it('still names Google Gemini when Gemini is the provider (and for older backends)', async () => {
  for (const capabilities of [
    { pdfPhotoOcrAvailable: true, ocrProvider: 'gemini', ocrPdfSupported: true },
    { pdfPhotoOcrAvailable: true },
  ]) {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const renderer = await renderWith(capabilities);
      await extract(renderer, { name: 'menu.pdf', size: 1200, lastModified: 1 });
      expect(confirm.mock.calls[0][0]).toContain('Google Gemini');
    } finally {
      confirm.mockRestore();
      jest.clearAllMocks();
    }
  }
});
