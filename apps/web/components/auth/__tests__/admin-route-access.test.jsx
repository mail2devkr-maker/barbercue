import { Role } from "@barbercue/shared";
import { canGenerateOfferLetter, canOpenAdminPath } from "../../../lib/admin-route-access";

describe("admin route boundary role matrix", () => {
  const paths = {
    overview: "/dashboard/admin",
    access: "/dashboard/admin/access",
    crm: "/dashboard/admin/crm",
    employees: "/dashboard/admin/employees",
    verification: "/dashboard/admin/verification",
    shops: "/dashboard/admin/shops",
  };

  test.each([
    [Role.PLATFORM_ADMIN, [true, true, true, true, true, true]],
    [Role.CO_FOUNDER, [true, false, true, true, true, true]],
    [Role.HR_ADMIN, [true, false, true, true, false, false]],
    [Role.SALES_ADMIN, [true, false, true, false, false, false]],
    [Role.PLATFORM_VIEWER, [true, false, false, false, false, false]],
    [Role.CUSTOMER, [false, false, false, false, false, false]],
  ])("applies least-privilege web affordances for %s", (role, expected) => {
    const pathList = Object.values(paths);
    pathList.forEach((path, index) => {
      expect(canOpenAdminPath([role], path)).toBe(expected[index]);
    });
  });

  test.each([
    [Role.PLATFORM_ADMIN, true],
    [Role.CO_FOUNDER, true],
    [Role.HR_ADMIN, true],
    [Role.SALES_ADMIN, false],
    [Role.PLATFORM_VIEWER, false],
  ])("keeps offer-letter tools scoped to HR/operations: %s", (role, expected) => {
    expect(canGenerateOfferLetter([role])).toBe(expected);
  });
});
