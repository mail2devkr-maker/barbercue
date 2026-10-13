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
    expect(renderer.root.findAllByType('strong').some((node) =>
      node.props.children.join('') === '0 ready to add out of 1 selected.'
    )).toBe(true);
    expect(renderer.root.findAllByType('p').some((node) =>
      Array.isArray(node.props.children) &&
      node.props.children.join('').includes('selected row(s) need a valid duration')
    )).toBe(true);
    const importButtons = renderer.root.findAllByType('button').filter((node) =>
      node.props.children === 'Import 0 reviewed services'
    );
    const addSelectedButtons = renderer.root.findAllByType('button').filter((node) =>
      node.props.children === 'Add selected services (1)'
    );
    expect(importButtons).toHaveLength(2);
    expect(importButtons.every((node) => node.props.disabled)).toBe(true);
    expect(addSelectedButtons).toHaveLength(2);
    expect(addSelectedButtons.every((node) => !node.props.disabled)).toBe(true);

    // The new button must not bypass required price/duration validation.
    await act(async () => addSelectedButtons[1].props.onClick());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(renderer.toJSON())).toContain('Cannot add all 1 selected services');

    // Once the employee enters an explicitly approved duration, the same button
    // follows the existing authenticated and duplicate-safe import-reviewed API.
    const minutes = renderer.root.findByProps({ 'aria-label': 'Minutes' });
    await act(async () => minutes.props.onChange({ target: { value: '30' } }));
    const eligible = renderer.root.findAllByType('button').find((node) =>
      node.props.children === 'Add selected services (1)'
    );
    apiFetch.mockResolvedValueOnce({
      createdCount: 1, skippedCount: 0, added: ['Haircut'], skipped: [],
    });
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await act(async () => eligible.props.onClick());
    } finally {
      confirm.mockRestore();
    }
    expect(apiFetch).toHaveBeenCalledTimes(2);
    const [endpoint, options] = apiFetch.mock.calls[1];
    expect(endpoint).toBe('dashboard/salons/s1/services/import-reviewed');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body).services).toEqual([
      { name: 'Haircut', price: 100, durationMinutes: 30 },
    ]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
