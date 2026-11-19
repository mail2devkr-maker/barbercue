import { Role } from "@barbercue/shared";
import { canOpenAdminPath } from "../admin-route-access";
import { draftPayload, formFromApplication, listHas, toggleListValue } from "../onboarding";
import { fromLocalInput, pretty, toLocalInput, when } from "../crm";

describe("CRM client helpers", () => {
  it("round-trips datetime-local values in IST", () => {
    const iso = "2026-11-18T10:30:00.000Z"; // 16:00 IST
    expect(toLocalInput(iso)).toBe("2026-11-18T16:00");
    expect(fromLocalInput("2026-11-18T16:00")).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("formats dates in IST and labels enums", () => {
    expect(when("2026-11-18T20:00:00Z", { day: "numeric", month: "short", timeZoneName: undefined })).toBe("19 Nov");
    expect(when(null)).toBe("—");
    expect(pretty("CALLBACK_REQUESTED")).toBe("Callback requested");
  });
});

describe("onboarding CRM 2.0 fields", () => {
  it("keeps list fields as comma strings in the form and arrays in the payload", () => {
    const form = formFromApplication({ weeklyHolidays: [0, 2], amenities: ["wifi"], consentMethod: null, consentByName: "Ramesh" });
    expect(form.weeklyHolidays).toBe("0,2");
    expect(form.amenities).toBe("wifi");
    const body = draftPayload({ ...form, consentMethod: "", washStationCount: "3", qrInstallReady: "true", inventoryInterest: "" });
    expect(body.weeklyHolidays).toEqual([0, 2]);
    expect(body.amenities).toEqual(["wifi"]);
    expect(body.consentMethod).toBeNull();
    expect(body.consentByName).toBe("Ramesh");
    expect(body.washStationCount).toBe(3);
    expect(body.qrInstallReady).toBe(true);
    expect(body.inventoryInterest).toBeNull();
  });

  it("toggles list values", () => {
    expect(toggleListValue("", "6")).toBe("6");
    expect(toggleListValue("0,6", "6")).toBe("0");
    expect(listHas("0,6", "6")).toBe(true);
    expect(listHas("16", "6")).toBe(false);
  });
});

describe("Field CRM 2.0 admin route", () => {
  it.each([
    [Role.PLATFORM_ADMIN, true],
    [Role.CO_FOUNDER, true],
    [Role.SALES_ADMIN, true],
    [Role.PLATFORM_VIEWER, true],
    [Role.HR_ADMIN, false],
    [Role.CUSTOMER, false],
  ])("%s → %s", (role, allowed) => {
    expect(canOpenAdminPath([role], "/dashboard/admin/field-crm")).toBe(allowed);
  });
});
