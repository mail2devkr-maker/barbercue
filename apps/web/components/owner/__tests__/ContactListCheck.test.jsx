import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ContactListCheck } from "../ContactListCheck";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

const preview = (statuses) => ({
  previewOnly: true,
  invitationEligibility: "NOT_EVALUATED",
  dispatchEnabled: false,
  dispatchBlockedReason: "CONSENT_SUPPRESSION_AND_PROVIDER_GATES_REQUIRED",
  summary: {
    total: statuses.length,
    validatedForReview: statuses.filter((s) => s === "VALIDATED_FOR_REVIEW").length,
    invalidPhone: statuses.filter((s) => s === "INVALID_PHONE").length,
    consentRequired: statuses.filter((s) => s === "CONSENT_REQUIRED").length,
    consentEvidenceIncomplete: statuses.filter((s) => s === "CONSENT_EVIDENCE_INCOMPLETE").length,
    consentTimestampInvalid: statuses.filter((s) => s === "CONSENT_TIMESTAMP_INVALID").length,
    duplicateInBatch: statuses.filter((s) => s === "DUPLICATE_IN_BATCH").length,
  },
  items: statuses.map((status, index) => ({ index, status })),
});

let calls;
function install(handler) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    return handler(JSON.parse(opts.body));
  });
}

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<ContactListCheck salonId="s1" />); });
  return r;
}
const type = async (r, value) => { await act(async () => { r.root.findByProps({ id: "contacts-text" }).props.onChange({ target: { value } }); }); };
const run = async (r) => { await act(async () => { button(r, "Check list").props.onClick(); }); await flush(); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("ContactListCheck", () => {
  it("says up front that it is a check only and that nothing is saved or sent", async () => {
    install(() => preview([]));
    const t = text(await mount());
    expect(t).toContain("check only");
    expect(t).toContain("does not save your list");
    expect(t).toContain("does not contact or invite anyone");
    expect(t).toContain("not proof");
  });

  it("asks for at least one number and sends nothing", async () => {
    install(() => preview([]));
    const r = await mount();
    await run(r);
    expect(text(r)).toContain("Add at least one phone number");
    expect(calls).toHaveLength(0);
  });

  it("sends only phones, with no consent unless the owner states it, and shows one row per line", async () => {
    install(() => preview(["CONSENT_REQUIRED", "INVALID_PHONE"]));
    const r = await mount();
    await type(r, "98765 43210\n12345");
    await run(r);
    expect(calls[0].path).toBe("dashboard/salons/s1/contacts/preview");
    expect(JSON.parse(calls[0].opts.body)).toEqual({ contacts: [{ phone: "98765 43210" }, { phone: "12345" }] });
    const t = text(r);
    expect(t).toContain("No agreement stated");
    expect(t).toContain("Not a valid number");
    expect(t).toContain("••••3210");
    expect(t).not.toContain("12345 ");
    expect(t).not.toMatch(/(?<!•)12345(?!\d)/);
  });

  it("sends the owner's statement of consent with a date, and refuses a future date before sending", async () => {
    install(() => preview(["VALIDATED_FOR_REVIEW"]));
    const r = await mount();
    await type(r, "9876543210");
    await act(async () => { r.root.findByProps({ id: "contacts-attested" }).props.onChange({ target: { checked: true } }); });
    await act(async () => { r.root.findByProps({ id: "contacts-source" }).props.onChange({ target: { value: "IN_PERSON" } }); });
    await act(async () => { r.root.findByProps({ id: "contacts-date" }).props.onChange({ target: { value: "2999-01-01" } }); });
    await run(r);
    expect(text(r)).toContain("cannot be in the future");
    expect(calls).toHaveLength(0);
    await act(async () => { r.root.findByProps({ id: "contacts-date" }).props.onChange({ target: { value: "2026-09-30" } }); });
    await run(r);
    expect(JSON.parse(calls[0].opts.body).contacts[0].consent).toEqual({ granted: true, source: "IN_PERSON", capturedAt: "2026-09-30T00:00:00.000Z" });
    expect(text(r)).toContain("Looks complete");
    expect(text(r)).toContain("not a decision to invite");
  });

  it("refuses more than 250 numbers and sends nothing", async () => {
    install(() => preview([]));
    const r = await mount();
    await type(r, Array.from({ length: 251 }, (_, i) => `98765${String(i).padStart(5, "0")}`).join("\n"));
    expect(text(r)).toMatch(/more than\s+250/);
    await run(r);
    expect(calls).toHaveLength(0);
  });

  it("reports unusable lines against their line numbers", async () => {
    install(() => preview(["CONSENT_REQUIRED"]));
    const r = await mount();
    await type(r, "9876543210\n9876543211, maybe");
    expect(text(r)).toMatch(/Line\s+2/);
    expect(text(r)).toContain("not a known way of agreeing");
    await run(r);
    expect(JSON.parse(calls[0].opts.body).contacts).toHaveLength(1);
  });

  it("shows summary counts", async () => {
    install(() => preview(["VALIDATED_FOR_REVIEW", "DUPLICATE_IN_BATCH", "DUPLICATE_IN_BATCH"]));
    const r = await mount();
    await type(r, "9876543210\n9876543210\n9876543210");
    await run(r);
    const t = text(r);
    expect(t).toMatch(/Checked\s+3/);
    expect(t).toMatch(/Repeated\s+2/);
    expect(t).toContain("Repeated number");
  });

  it("explains a rate limit and a missing feature plainly", async () => {
    const r = await mount();
    await type(r, "9876543210");
    install(() => { throw new ApiError("Too many requests", 429); });
    await run(r);
    expect(text(r)).toContain("Wait a minute");
    install(() => { throw new ApiError("Not found", 404); });
    await run(r);
    expect(text(r)).toContain("not available for your shop yet");
  });

  it("shows the server's message for any other failure and shows no result", async () => {
    install(() => { throw new ApiError("You do not have access to this shop.", 403); });
    const r = await mount();
    await type(r, "9876543210");
    await run(r);
    expect(text(r)).toContain("You do not have access to this shop.");
    expect(text(r)).not.toContain("Result");
  });

  it("shows nothing when the answer does not match the list that was sent", async () => {
    install(() => preview(["CONSENT_REQUIRED", "CONSENT_REQUIRED"]));
    const r = await mount();
    await type(r, "9876543210");
    await run(r);
    expect(text(r)).toContain("could not match");
    expect(text(r)).not.toContain("No agreement stated");
  });

  it("clears the list and the result", async () => {
    install(() => preview(["CONSENT_REQUIRED"]));
    const r = await mount();
    await type(r, "9876543210");
    await run(r);
    expect(text(r)).toContain("Result");
    await act(async () => { button(r, "Clear list").props.onClick(); });
    expect(r.root.findByProps({ id: "contacts-text" }).props.value).toBe("");
    expect(text(r)).not.toContain("Result");
  });

  it("drops an old result as soon as the list is edited", async () => {
    install(() => preview(["CONSENT_REQUIRED"]));
    const r = await mount();
    await type(r, "9876543210");
    await run(r);
    await type(r, "9876543210\n9876543211");
    expect(text(r)).not.toContain("Result");
  });

  describe("reading a contacts file (owner issue #14)", () => {
    const fileInput = (r) => r.root.findByProps({ id: "contacts-file" });
    const fakeFile = (name, content, size) => ({ name, size: size ?? content.length, text: jest.fn(async () => content) });
    const choose = async (r, file) => {
      const target = { files: [file], value: "C:\\fakepath\\" + file.name };
      await act(async () => { await fileInput(r).props.onChange({ target }); });
      await flush();
      return target;
    };
    const box = (r) => r.root.findByProps({ id: "contacts-text" }).props.value;

    it("puts the numbers from a CSV into the list box for review, uploads nothing, and resets the file input", async () => {
      install(() => preview([]));
      const r = await mount();
      const target = await choose(r, fakeFile("clients.csv", "Name,Phone\nAsha,98765 43210\nRavi,+91 91234 56789\n"));
      expect(box(r)).toBe("98765 43210\n+91 91234 56789");
      const t = text(r);
      expect(t).toContain("Read 2 numbers from clients.csv");
      expect(t).toContain("The file stays on your device");
      expect(t).not.toMatch(/Asha|Ravi/);
      expect(calls).toEqual([]);
      expect(apiFetch).not.toHaveBeenCalled();
      expect(target.value).toBe("");
    });

    it("reads a phone-export vCard, and the check then sends only those numbers - no names, no file", async () => {
      install(() => preview(["VALIDATED_FOR_REVIEW", "VALIDATED_FOR_REVIEW"]));
      const r = await mount();
      await choose(r, fakeFile("contacts.vcf", "BEGIN:VCARD\nVERSION:3.0\nFN:Asha Kapoor\nTEL;TYPE=CELL:9876543210\nEND:VCARD\nBEGIN:VCARD\nFN:Ravi Shah\nTEL:9123456789\nEND:VCARD\n"));
      expect(box(r)).toBe("9876543210\n9123456789");
      expect(calls).toEqual([]);
      await act(async () => { r.root.findByProps({ id: "contacts-attested" }).props.onChange({ target: { checked: true } }); });
      await run(r);
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(calls[0].opts.body)).not.toMatch(/Asha|Ravi|vcf|VCARD/);
      const sent = JSON.parse(calls[0].opts.body);
      expect(sent.contacts.map((c) => c.phone)).toEqual(["9876543210", "9123456789"]);
    });

    it("tells the owner which lines were left out and why, never inventing a number", async () => {
      install(() => preview([]));
      const r = await mount();
      await choose(r, fakeFile("c.csv", "Phone\n9876543210\n=HYPERLINK(\"http://x.test\")\nnot a number\n"));
      expect(box(r)).toBe("9876543210");
      const t = text(r);
      expect(t).toContain("Line 3: Not a plain phone number, so it was left out.");
      expect(t).toContain("Line 4: Not a plain phone number, so it was left out.");
      expect(t).not.toContain("HYPERLINK");
    });

    it("refuses an unsupported file type without reading it", async () => {
      install(() => preview([]));
      const r = await mount();
      const file = fakeFile("clients.xlsx", "x");
      await choose(r, file);
      expect(file.text).not.toHaveBeenCalled();
      expect(box(r)).toBe("");
      expect(text(r)).toContain("That kind of file is not supported");
    });

    it("refuses an oversized file without reading it", async () => {
      install(() => preview([]));
      const r = await mount();
      const file = fakeFile("huge.csv", "Phone\n9876543210", 600 * 1024);
      await choose(r, file);
      expect(file.text).not.toHaveBeenCalled();
      expect(text(r)).toContain("larger than 512 KB");
    });

    it("keeps what was already typed when the file has no usable numbers", async () => {
      install(() => preview([]));
      const r = await mount();
      await type(r, "9000000001");
      await choose(r, fakeFile("c.csv", "Name,City\nAsha,Delhi\n"));
      expect(box(r)).toBe("9000000001");
      expect(text(r)).toContain("No phone numbers could be read from c.csv");
      expect(text(r)).toContain("What was in the box is unchanged");
    });

    it("says when it replaced typed numbers, so nothing disappears silently", async () => {
      install(() => preview([]));
      const r = await mount();
      await type(r, "9000000001");
      await choose(r, fakeFile("c.csv", "9876543210\n"));
      expect(box(r)).toBe("9876543210");
      expect(text(r)).toContain("replacing what was there");
    });

    it("reports a file the browser cannot read and changes nothing", async () => {
      install(() => preview([]));
      const r = await mount();
      await type(r, "9000000001");
      const bad = { name: "c.csv", size: 10, text: jest.fn(async () => { throw new Error("denied"); }) };
      await choose(r, bad);
      expect(box(r)).toBe("9000000001");
      expect(text(r)).toContain("Could not read that file. Nothing was changed.");
      expect(text(r)).not.toContain("denied");
    });

    it("does nothing when the file dialog is cancelled", async () => {
      install(() => preview([]));
      const r = await mount();
      await act(async () => { await fileInput(r).props.onChange({ target: { files: [], value: "" } }); });
      expect(box(r)).toBe("");
      expect(text(r)).not.toContain("Read ");
    });
  });
});
