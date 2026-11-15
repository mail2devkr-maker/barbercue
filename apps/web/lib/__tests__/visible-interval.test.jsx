// Node test environment (the repo's jest config): a minimal fake page provides document/window.
import { setVisibleInterval } from "../visible-interval";

let state = "visible";
const fakeDocument = new EventTarget();
Object.defineProperty(fakeDocument, "visibilityState", { get: () => state });

function setVisibility(next) {
  state = next;
  fakeDocument.dispatchEvent(new Event("visibilitychange"));
}

describe("setVisibleInterval", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    state = "visible";
    global.document = fakeDocument;
    global.window = { setInterval: (...a) => setInterval(...a), clearInterval: (id) => clearInterval(id) };
  });
  afterEach(() => {
    jest.useRealTimers();
    delete global.document;
    delete global.window;
  });

  it("polls while visible, pauses while hidden, and refreshes at once on return", () => {
    const fn = jest.fn();
    const stop = setVisibleInterval(fn, 1000);
    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);

    setVisibility("hidden");
    jest.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(3);

    setVisibility("visible");
    expect(fn).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(5);
    stop();
    jest.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("does not start ticking when created in a hidden tab, and cleanup removes the listener", () => {
    state = "hidden";
    const fn = jest.fn();
    const stop = setVisibleInterval(fn, 1000);
    jest.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    stop();
    setVisibility("visible");
    expect(fn).not.toHaveBeenCalled();
  });

  it("behaves like a plain interval outside a browser", () => {
    delete global.document;
    delete global.window;
    const fn = jest.fn();
    const stop = setVisibleInterval(fn, 1000);
    jest.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });
});
