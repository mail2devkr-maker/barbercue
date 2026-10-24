import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ShopContactNote } from "../ShopContactNote";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const collect = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : Array.isArray(node)
        ? node.map(collect).join("")
        : collect(node.children);

function render(props) {
  let r;
  act(() => {
    r = TestRenderer.create(<ShopContactNote salonName="Fade House" purpose="charge" {...props} />);
  });
  return r;
}

describe("ShopContactNote (owner issue #45)", () => {
  it("renders nothing when the shop has not published a phone (no placeholder, no invented number)", () => {
    for (const shopPhone of [null, undefined, "", "   "]) {
      expect(render({ shopPhone }).toJSON()).toBeNull();
    }
  });

  it("renders nothing for a value that cannot be dialled", () => {
    expect(render({ shopPhone: "123" }).toJSON()).toBeNull();
    expect(render({ shopPhone: "call me maybe" }).toJSON()).toBeNull();
    expect(render({ shopPhone: "1".repeat(20) }).toJSON()).toBeNull();
  });

  it("links the published business phone with a safe tel: URL for a cancellation charge", () => {
    const r = render({ shopPhone: "+91 98765-43210", purpose: "charge" });
    expect(r.root.findByType("a").props.href).toBe("tel:+919876543210");
    const text = collect(r.toJSON());
    expect(text).toContain("To ask Fade House about this charge, call");
    expect(text).toContain("+91 98765-43210");
  });

  it("uses reschedule wording when shown inside the reschedule dialog", () => {
    const r = render({ shopPhone: "+919876543210", purpose: "reschedule" });
    expect(collect(r.toJSON())).toContain("To arrange a different change with Fade House, call");
  });

  it("does not turn markup in the phone text into a link or script", () => {
    expect(render({ shopPhone: "<script>alert(1)</script>" }).toJSON()).toBeNull();
  });

  it("shows only the published shop phone: an owner/account number passed alongside is never displayed", () => {
    const r = render({ shopPhone: "+919876543210", ownerPhone: "+911111111111", phone: "+912222222222", user: { phone: "+913333333333" } });
    const text = collect(r.toJSON());
    expect(text).toContain("+919876543210");
    expect(text).not.toMatch(/1111111111|2222222222|3333333333/);
  });
});
