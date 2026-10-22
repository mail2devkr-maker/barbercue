/** Shared helpers for react-test-renderer based HR register tests (plain JS, not a test file). */
import { act } from "react";
import TestRenderer from "react-test-renderer";

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    // Adjacent text nodes belong to one visible string; elements are separated by a space.
    const plain = node.every((item) => typeof item === "string" || typeof item === "number");
    return node.map(collect).join(plain ? "" : " ");
  }
  return collect(node.children);
};

const text = (renderer) => collect(renderer.toJSON()).replace(/\s+/g, " ");
const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const nodeText = (node) => collect(node.children).replace(/\s+/g, " ");

function buttons(renderer, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  return renderer.root.findAll((n) => n.type === "button" && re.test(nodeText(n)));
}

function button(renderer, pattern) {
  const found = buttons(renderer, pattern);
  if (found.length === 0) throw new Error(`No button matching ${pattern}. Page text: ${text(renderer).slice(0, 400)}`);
  return found[0];
}

const hasButton = (renderer, pattern) => buttons(renderer, pattern).length > 0;

async function click(renderer, pattern) {
  let node = button(renderer, pattern);
  // A button disabled only because an async step (save, PDF, letter read) is still settling gets a bounded wait,
  // so slower machines (CI) do not make the suite flaky. A button that stays disabled still fails loudly.
  for (let attempt = 0; attempt < 60 && node.props.disabled; attempt += 1) {
    await flush();
    node = button(renderer, pattern);
  }
  if (node.props.disabled) throw new Error(`Button ${pattern} is disabled`);
  await act(async () => {
    node.props.onClick({ preventDefault() {} });
  });
  await flush();
}

/** The <input>/<select>/<textarea> inside the first <label> whose text matches. */
function field(renderer, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const labels = renderer.root.findAll((n) => n.type === "label" && re.test(nodeText(n)));
  if (labels.length === 0) throw new Error(`No label matching ${pattern}`);
  const control = labels[0].findAll((n) => ["input", "select", "textarea"].includes(n.type))[0];
  if (!control) throw new Error(`Label ${pattern} has no control`);
  return control;
}

async function setValue(renderer, pattern, value) {
  const control = field(renderer, pattern);
  await act(async () => {
    control.props.onChange({ target: { value } });
  });
}

async function setChecked(renderer, pattern, checked = true) {
  const control = field(renderer, pattern);
  await act(async () => {
    control.props.onChange({ target: { checked } });
  });
}

async function submit(renderer, labelOrIndex = 0) {
  const forms = renderer.root.findAllByType("form");
  const form = typeof labelOrIndex === "string" ? forms.find((f) => f.props["aria-label"] === labelOrIndex) : forms[labelOrIndex];
  if (!form) throw new Error("form not found");
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} });
  });
  await flush();
}

async function mount(element) {
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  await flush();
  return renderer;
}

/** Wraps a fake register so every mutation's idempotency key is captured. */
function spyOnKeys(api) {
  const keys = [];
  for (const name of ["createOffer", "transitionOffer", "recordJoining", "recordNotJoined", "recordExit", "recordPdfEvent", "linkReconciliation", "markReconciliationDuplicate", "createReconciliationIdentity"]) {
    const original = api[name].bind(api);
    api[name] = (...args) => {
      keys.push({ name, key: args[args.length - 1] });
      return original(...args);
    };
  }
  return keys;
}

export { act, collect, text, flush, buttons, button, hasButton, click, field, setValue, setChecked, submit, mount, spyOnKeys };
