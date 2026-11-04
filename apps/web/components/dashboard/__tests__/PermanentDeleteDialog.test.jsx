import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { PermanentDeleteDialog } from '../PermanentDeleteDialog';
import { apiFetch, ApiError } from '../../../lib/api';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  },
}));
// The real Dialog moves focus with document APIs; a plain wrapper is enough for these flow tests.
jest.mock('../../owner/parts', () => ({
  Dialog: ({ title, children }) => <section role="dialog" aria-label={title}>{children}</section>,
  Banner: ({ children }) => <p>{children}</p>,
  Btn: ({ children, variant, small, ...rest }) => <button type="button" data-variant={variant} {...rest}>{children}</button>,
}));

const textOf = (node) => (typeof node === 'string' ? node : (node.children ?? []).map(textOf).join(''));
const button = (tree, label) => tree.root.find((n) => n.type === 'button' && textOf(n) === label);
const BASE = 'dashboard/salons/s1/chairs/c2';

const deletable = {
  kind: 'chair',
  target: { id: 'c2', name: 'Chair 2', status: 'ACTIVE' },
  salon: { id: 's1', name: 'Handsome Center' },
  deletable: true,
  blockers: [],
  effects: ['"Chair 2" is removed from Handsome Center for good and cannot be restored.'],
  confirmName: 'Chair 2',
  alternative: null,
  token: 'signed-token-0123456789-abcdef',
  expiresAt: '2026-11-04T12:05:00.000Z',
};

beforeEach(() => {
  apiFetch.mockReset();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function open(previewReply, props = {}) {
  apiFetch.mockImplementationOnce(() => (previewReply instanceof Error ? Promise.reject(previewReply) : Promise.resolve(previewReply)));
  const onDeleted = jest.fn();
  const onClose = jest.fn();
  let tree;
  await act(async () => {
    tree = TestRenderer.create(<PermanentDeleteDialog kind="chair" salonId="s1" targetId="c2" onClose={onClose} onDeleted={onDeleted} {...props} />);
  });
  return { tree, onDeleted, onClose };
}

describe('PermanentDeleteDialog (#378)', () => {
  it('opening only previews: one POST to the preview endpoint, nothing deleted', async () => {
    const { tree } = await open(deletable);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(`${BASE}/deletion-preview`, { method: 'POST' });
    expect(textOf(tree.root)).toContain('Chair 2');
    expect(textOf(tree.root)).toContain('Handsome Center');
    expect(textOf(tree.root)).toContain('cannot be undone');
  });

  it('Confirm Delete stays off until the exact name is typed AND the box is ticked; Enter alone does nothing', async () => {
    const { tree, onDeleted } = await open(deletable);
    const confirm = () => button(tree, 'Confirm Delete');
    expect(confirm().props.disabled).toBe(true);
    const input = tree.root.find((n) => n.type === 'input' && n.props.id === 'permanent-delete-name');
    await act(async () => input.props.onChange({ target: { value: 'chair 2' } }));
    const box = tree.root.find((n) => n.type === 'input' && n.props.type === 'checkbox');
    await act(async () => box.props.onChange({ target: { checked: true } }));
    expect(confirm().props.disabled).toBe(true); // wrong case
    const enter = { key: 'Enter', preventDefault: jest.fn() };
    input.props.onKeyDown(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    await act(async () => input.props.onChange({ target: { value: 'Chair 2' } }));
    expect(confirm().props.disabled).toBe(false);
    await act(async () => box.props.onChange({ target: { checked: false } }));
    expect(confirm().props.disabled).toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('confirms with the token, the typed name and the acknowledgement, then reports the deletion', async () => {
    const { tree, onDeleted } = await open(deletable);
    await act(async () => tree.root.find((n) => n.props.id === 'permanent-delete-name').props.onChange({ target: { value: 'Chair 2' } }));
    await act(async () => tree.root.find((n) => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }));
    const result = { kind: 'chair', deletedId: 'c2', name: 'Chair 2', message: 'Chair 2 was permanently deleted.' };
    apiFetch.mockResolvedValueOnce(result);
    await act(async () => button(tree, 'Confirm Delete').props.onClick());
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/permanent-deletion`, {
      method: 'POST',
      body: JSON.stringify({ token: deletable.token, typedName: 'Chair 2', acknowledged: true }),
    });
    expect(onDeleted).toHaveBeenCalledWith(result);
  });

  it('a blocked record shows why, offers the safe alternative, and has no Confirm button', async () => {
    const { tree } = await open({
      ...deletable,
      deletable: false,
      token: undefined,
      blockers: [{ code: 'SERVICE_HISTORY', count: 12, message: 'This chair has 12 service record(s) in your history.' }],
      alternative: 'Use "Remove chair" instead: it switches the chair off and keeps its history.',
    });
    expect(textOf(tree.root)).toContain('cannot be permanently deleted');
    expect(textOf(tree.root)).toContain('12 service record(s)');
    expect(textOf(tree.root)).toContain('Remove chair');
    expect(tree.root.findAll((n) => n.type === 'button' && textOf(n) === 'Confirm Delete')).toHaveLength(0);
  });

  it('a server refusal (stale / expired / blocked) is shown, nothing is removed from the screen, and the check can be repeated', async () => {
    const { tree, onDeleted } = await open(deletable);
    await act(async () => tree.root.find((n) => n.props.id === 'permanent-delete-name').props.onChange({ target: { value: 'Chair 2' } }));
    await act(async () => tree.root.find((n) => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }));
    apiFetch.mockRejectedValueOnce(new ApiError('This record changed after you opened the dialog. Nothing was deleted.', 409));
    await act(async () => button(tree, 'Confirm Delete').props.onClick());
    expect(textOf(tree.root)).toContain('Nothing was deleted');
    expect(onDeleted).not.toHaveBeenCalled();
    apiFetch.mockResolvedValueOnce(deletable);
    await act(async () => button(tree, 'Check again').props.onClick());
    expect(apiFetch).toHaveBeenLastCalledWith(`${BASE}/deletion-preview`, { method: 'POST' });
  });

  it('Cancel closes without any request', async () => {
    const { tree, onClose } = await open(deletable);
    await act(async () => button(tree, 'Cancel').props.onClick());
    expect(onClose).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('staff dialog uses the staff endpoint', async () => {
    await open({ ...deletable, kind: 'staff' }, { kind: 'staff', targetId: 'st1' });
    expect(apiFetch).toHaveBeenCalledWith('dashboard/salons/s1/staff/st1/deletion-preview', { method: 'POST' });
  });
});
