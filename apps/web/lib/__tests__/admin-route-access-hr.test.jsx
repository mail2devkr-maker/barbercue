import { Role } from "@barbercue/shared";
import { canGenerateOfferLetter, canOpenAdminPath, canUseHrRegister } from "../admin-route-access";

const HR_PATH = "/dashboard/admin/hr";

describe("HR offer register access (client-side affordance; backend RolesGuard is the authority)", () => {
  test.each([[Role.HR_ADMIN], [Role.CO_FOUNDER], [Role.PLATFORM_ADMIN]])("%s may open the register and use it", (role) => {
    expect(canOpenAdminPath([role], HR_PATH)).toBe(true);
    expect(canUseHrRegister([role])).toBe(true);
  });

  test.each([[Role.SALES_ADMIN], [Role.PLATFORM_VIEWER]])("%s may not", (role) => {
    expect(canOpenAdminPath([role], HR_PATH)).toBe(false);
    expect(canUseHrRegister([role])).toBe(false);
  });

  test.each([[Role.CUSTOMER], [Role.SALON_OWNER], [Role.BARBER]])("%s is not an internal admin at all", (role) => {
    expect(canOpenAdminPath([role], HR_PATH)).toBe(false);
    expect(canUseHrRegister([role])).toBe(false);
  });

  test("the register has exactly the offer-letter audience", () => {
    for (const role of Object.values(Role)) {
      expect(canUseHrRegister([role])).toBe(canGenerateOfferLetter([role]));
    }
  });

  test("existing admin routes keep their audiences", () => {
    expect(canOpenAdminPath([Role.HR_ADMIN], "/dashboard/admin/employees")).toBe(true);
    expect(canOpenAdminPath([Role.HR_ADMIN], "/dashboard/admin/crm")).toBe(true);
    expect(canOpenAdminPath([Role.SALES_ADMIN], "/dashboard/admin/crm")).toBe(true);
    expect(canOpenAdminPath([Role.SALES_ADMIN], "/dashboard/admin/employees")).toBe(false);
    expect(canOpenAdminPath([Role.HR_ADMIN], "/dashboard/admin/verification")).toBe(false);
  });
});
