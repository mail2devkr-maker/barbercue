import { resolveFollowUp } from "../assistant-followup";

const staff = [
  { label: "Ramesh Kumar", text: "Deactivate staff Ramesh Kumar" },
  { label: "Suresh", text: "Deactivate staff Suresh" },
  { label: "Ramu", text: "Deactivate staff Ramu" },
];

describe("Assistant multi-turn follow-ups", () => {
  it.each([
    ["ramesh", "Deactivate staff Ramesh Kumar"],
    ["Ramesh Kumar", "Deactivate staff Ramesh Kumar"],
    ["suresh ko", "Deactivate staff Suresh"],
    ["Suresh.", "Deactivate staff Suresh"],
    ["pehla wala", "Deactivate staff Ramesh Kumar"],
    ["doosra", "Deactivate staff Suresh"],
    ["दूसरा", "Deactivate staff Suresh"],
    ["option 3", "Deactivate staff Ramu"],
    ["number do", "Deactivate staff Suresh"],
    ["the first one", "Deactivate staff Ramesh Kumar"],
    ["2", "Deactivate staff Suresh"],
  ])("%s -> %s", (said, want) => {
    expect(resolveFollowUp(said, staff)).toBe(want);
  });

  it("ambiguous or unknown answers are sent unchanged", () => {
    expect(resolveFollowUp("ram", staff)).toBeNull(); // Ramesh and Ramu both start with "ram"
    expect(resolveFollowUp("mahesh", staff)).toBeNull();
    expect(resolveFollowUp("chautha", staff)).toBeNull(); // only three options
  });

  it("a new full request is never hijacked by an earlier question", () => {
    expect(
      resolveFollowUp("suresh ka kal ka schedule dikhao please", staff),
    ).toBeNull();
    expect(resolveFollowUp("staff list dikhao", staff)).toBeNull();
  });

  it("does nothing when there is no open question", () => {
    expect(resolveFollowUp("ramesh", null)).toBeNull();
    expect(resolveFollowUp("ramesh", [])).toBeNull();
  });
});
