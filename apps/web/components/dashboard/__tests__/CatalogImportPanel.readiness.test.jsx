import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { CatalogImportPanel } from '../CatalogImportPanel';
import { apiFetch } from '../../../lib/api';
import { extractCatalogLocally } from '../../../lib/catalog-local-ocr';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('../../../lib/catalog-local-ocr', () => ({
  extractCatalogLocally: jest.fn(),
  parseCatalogRateText: jest.fn(() => []),
}));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

it('selects private on-device OCR by default when server Gemini OCR is unconfigured', async () => {
  apiFetch.mockResolvedValue({ pdfPhotoOcrAvailable: false });
  extractCatalogLocally.mockResolvedValue({
    text: 'Haircut - 100',
    services: [{ name: 'Haircut', price: 100, durationMinutes: null, category: '', description: '', source: 'catalog.pdf' }],
    notes: [],
  });
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
    expect(JSON.stringify(renderer.toJSON())).toContain('Free on-device OCR is available');
    const input = renderer.root.findByProps({ id: 'catalog-multiple-input' });
    const file = { name: 'catalog.pdf', size: 1200, lastModified: 1 };
    await act(async () => input.props.onChange({ target: { files: [file] } }));
    expect(renderer.root.findAllByType('li')).toHaveLength(1);
    const button = renderer.root.findAllByType('button').find((node) =>
      node.props.children === 'Step 1: Extract & preview (1)'
    );
    expect(button).toBeDefined();
    await act(async () => button.props.onClick());
    expect(extractCatalogLocally).toHaveBeenCalledWith(file, expect.any(Function));
    // No catalog upload to third parties/backend. Review/Save remains an explicit step.
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('Haircut');
    expect(JSON.stringify(renderer.toJSON())).toContain('Recognized catalog text');
    expect(JSON.stringify(renderer.toJSON())).toContain('0 ready to add out of 1 selected');
    expect(JSON.stringify(renderer.toJSON())).toContain('1 selected row(s) need a valid duration');
    const addButtons = renderer.root.findAllByType('button').filter((node) =>
      typeof node.props.children === 'string' &&
      node.props.children.startsWith('Step 3: Add ')
    );
    expect(addButtons.length).toBeGreaterThan(0);
    expect(addButtons.every((node) => node.props.disabled)).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
