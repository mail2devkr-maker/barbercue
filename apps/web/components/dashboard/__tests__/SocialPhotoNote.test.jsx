import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { SocialPhotoNote } from "../SocialPhotoNote";

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};

const mount = () => { let r; act(() => { r = TestRenderer.create(<SocialPhotoNote />); }); return r; };

describe("SocialPhotoNote (owner issue #20)", () => {
  it("says FastQue cannot import social photos and gives the manual route", () => {
    const t = collect(mount().toJSON());
    expect(t).toContain("not connected to your social accounts");
    expect(t).toContain("cannot import them");
    expect(t).toContain("Save the photo");
    expect(t).toContain("permission to use");
  });
  it("offers no import control", () => {
    const r = mount();
    expect(r.root.findAllByType("button")).toHaveLength(0);
    expect(r.root.findAllByType("input")).toHaveLength(0);
  });
});
