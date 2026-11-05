import { Role } from "@barbercue/shared";
import { canPermanentlyDelete } from "../permanent-delete-access";

it("shows permanent delete only to roles the server accepts", () => {
  expect(canPermanentlyDelete([Role.SALON_OWNER])).toBe(true);
  expect(canPermanentlyDelete([Role.PLATFORM_ADMIN])).toBe(true);
  expect(canPermanentlyDelete([Role.CO_FOUNDER])).toBe(false);
  expect(canPermanentlyDelete([Role.SALON_STAFF])).toBe(false);
  expect(canPermanentlyDelete(undefined)).toBe(false);
});
