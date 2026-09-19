import { SalonStatus } from "@barbercue/shared";
import { getNextShopStatus } from "./page";

describe("platform admin shop lifecycle actions", () => {
  it("maps pending shops to the explicit Open shop action", () => {
    expect(getNextShopStatus(SalonStatus.PENDING)).toEqual({ status: SalonStatus.ACTIVE, label: "Open shop" });
  });

  it("maps active shops to Suspend and suspended shops to Re-open", () => {
    expect(getNextShopStatus(SalonStatus.ACTIVE)).toEqual({ status: SalonStatus.SUSPENDED, label: "Suspend" });
    expect(getNextShopStatus(SalonStatus.SUSPENDED)).toEqual({ status: SalonStatus.ACTIVE, label: "Re-open" });
  });
});
