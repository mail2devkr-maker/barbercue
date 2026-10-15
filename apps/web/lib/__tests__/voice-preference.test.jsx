// Node Jest environment: browser storage is simulated, never production or network.
const STORE_KEY = "fastque-owner-voice-enabled-v1";

function fakeBrowser(initial = {}) {
  const data = new Map(Object.entries(initial));
  const handlers = new Map();
  const localStorage = {
    getItem: jest.fn((key) => data.get(key) ?? null),
    setItem: jest.fn((key, value) => { data.set(key, String(value)); }),
    removeItem: jest.fn((key) => { data.delete(key); }),
  };
  globalThis.window = {
    localStorage,
    addEventListener: jest.fn((name, cb) => handlers.set(name, cb)),
    removeEventListener: jest.fn((name) => handlers.delete(name)),
  };
  return { data, localStorage, handlers };
}

beforeEach(() => { jest.resetModules(); });
afterEach(() => { delete globalThis.window; });

describe("Owner Live Queue voice-enabled preference", () => {
  it("persists explicit ON after a module reload and across navigation", () => {
    const b = fakeBrowser();
    const first = require("../voice-preference");
    expect(first.getVoiceEnabled()).toBe(false);
    first.setVoiceEnabled(true);
    expect(b.localStorage.setItem).toHaveBeenCalledWith(STORE_KEY, "on");
    expect(first.getVoiceEnabled()).toBe(true);

    jest.resetModules();
    const again = require("../voice-preference");
    expect(again.getVoiceEnabled()).toBe(true);
    expect(b.localStorage.getItem).toHaveBeenCalledWith(STORE_KEY);
  });

  it("persists explicit OFF after confirmation and does not unexpectedly reset to ON", () => {
    fakeBrowser({ [STORE_KEY]: "on" });
    const first = require("../voice-preference");
    expect(first.getVoiceEnabled()).toBe(true);
    first.setVoiceEnabled(false);
    jest.resetModules();
    const again = require("../voice-preference");
    expect(again.getVoiceEnabled()).toBe(false);
  });

  it("defaults off only for an owner who has never enabled it", () => {
    fakeBrowser();
    expect(require("../voice-preference").getVoiceEnabled()).toBe(false);
  });

  it("survives browsers that block localStorage access for this tab's lifetime", () => {
    globalThis.window = { localStorage: { getItem: () => { throw Error("blocked"); },
      setItem: () => { throw Error("blocked"); } } };
    const store = require("../voice-preference");
    store.setVoiceEnabled(true);
    expect(store.getVoiceEnabled()).toBe(true);
    store.setVoiceEnabled(false);
    expect(store.getVoiceEnabled()).toBe(false);
  });

  it("notifies listeners of changes from another tab", () => {
    const { handlers } = fakeBrowser({ [STORE_KEY]: "on" });
    const store = require("../voice-preference");
    const listener = jest.fn();
    const off = store.useVoiceEnabled; // exported subscription hook is tested through the external-store API below
    expect(typeof off).toBe("function");
    const React = require("react");
    const renderer = require("react-test-renderer");
    let tree;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    return renderer.act(async () => {
      tree = renderer.create(React.createElement(() => {
        const enabled = store.useVoiceEnabled();
        return React.createElement("span", null, enabled ? "on" : "off");
      }));
    }).then(async () => {
      expect(tree.toJSON().children[0]).toBe("on");
      expect(handlers.has("storage")).toBe(true);
      await renderer.act(async () => {
        handlers.get("storage")({ key: STORE_KEY, newValue: "off" });
      });
      expect(tree.toJSON().children[0]).toBe("off");
      await renderer.act(async () => { tree.unmount(); });
      expect(handlers.has("storage")).toBe(false);
    });
  });
});
