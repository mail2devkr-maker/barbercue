/// <reference types="jest" />
import { act, createElement } from "react";
import { Text } from "react-native";
import TestRenderer from "react-test-renderer";
import type { InvoiceListDto, PublicOfferDto } from "@barbercue/shared";
import OffersScreen from "../OffersScreen";
import MyInvoicesScreen from "../MyInvoicesScreen";
import { apiFetch } from "../../lib/api";

jest.mock("../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../lib/language-context", () => ({
  useLanguage: () => ({
    language: "EN",
    t: {
      trustOffersLabel: "Offers",
      findASalonTitle: "Find a salon",
      loadMore: "Load more",
    },
  }),
}));
jest.mock("../../lib/date-locale", () => ({ dateLocaleFor: () => "en-IN" }));
jest.mock("@react-navigation/native", () => ({
  useFocusEffect: (effect: () => void | (() => void)) =>
    require("react").useEffect(effect, []),
}));
jest.mock("../../components/ui", () => {
  const { createElement: el } = require("react");
  const {
    Text: NativeText,
    View: NativeView,
    Pressable: NativePressable,
  } = require("react-native");
  return {
    EmptyState: ({ title, message, actionLabel, onAction }: any) =>
      el(
        NativeView,
        null,
        el(NativeText, null, title),
        message ? el(NativeText, null, message) : null,
        actionLabel
          ? el(
              NativePressable,
              { onPress: onAction },
              el(NativeText, null, actionLabel),
            )
          : null,
      ),
    InlineError: ({ message }: any) => el(NativeText, null, message),
    Screen: ({ children }: any) => el(NativeView, null, children),
    SectionHeader: ({ title, subtitle }: any) =>
      el(
        NativeView,
        null,
        el(NativeText, null, title),
        subtitle ? el(NativeText, null, subtitle) : null,
      ),
    Skeleton: () => null,
  };
});
const sampleOffer = {
  id: "offer-123",
  salonId: "salon-ignored",
  kind: "OFFER",
  status: "ACTIVE",
  title: "Weekday trim",
  description: "A current shop offer",
  discountType: "PERCENT",
  discountValue: 20,
  currency: "INR",
  audience: "ALL",
  inactiveDays: null,
  validFrom: "2026-10-26T00:00:00.000Z",
  validTo: "2026-11-01T00:00:00.000Z",
  maxRedemptions: null,
  perCustomerLimit: 1,
  serviceIds: [],
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  salon: {
    id: "salon-1",
    name: "Sample Salon",
    slug: "sample-salon",
    city: "Pune",
    countryCode: "IN",
    citySlug: "pune",
  },
  eligibility: { audience: "ALL", accountRequired: false },
  prices: [
    {
      serviceId: "service-1",
      serviceName: "Haircut",
      basePrice: 300,
      discount: 60,
      finalPrice: 240,
      currency: "INR",
    },
  ],
} as PublicOfferDto;

const invoiceSummary = {
  id: "invoice-1",
  number: "FQ-0001",
  salonId: "salon-1",
  sourceType: "BOOKING",
  bookingId: "booking-1",
  queueEntryId: null,
  customerName: "Synthetic customer",
  currency: "INR",
  total: 240,
  amountPaid: 0,
  amountRefunded: 0,
  balanceDue: 240,
  paymentStatus: "UNPAID",
  status: "ISSUED",
  issuedAt: "2026-10-26T00:00:00.000Z",
  serviceDate: "2026-10-27T00:00:00.000Z",
};

let tree: ReturnType<typeof TestRenderer.create>;
const navigate = jest.fn();

function textOf(instance: any): string {
  return instance.children
    .map((child: any) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}
function pressableContaining(label: string) {
  return tree.root.findAll(
    (node: any) =>
      typeof node.props.onPress === "function" && textOf(node).includes(label),
  )[0];
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
});

it("loads public offers for signed-out discovery and opens the canonical shop booking with the offer ID", async () => {
  (apiFetch as jest.Mock).mockResolvedValue({
    items: [sampleOffer],
    nextCursor: null,
  });
  await act(async () => {
    tree = TestRenderer.create(
      createElement(OffersScreen, { navigation: { navigate } } as never),
    );
  });

  expect(apiFetch).toHaveBeenCalledWith("offers?limit=20");
  expect(
    tree.root
      .findAll((node: any) => node.type === Text)
      .map(textOf)
      .join(" "),
  ).toContain("Weekday trim");
  expect(
    tree.root
      .findAll((node: any) => node.type === Text)
      .map(textOf)
      .join(" "),
  ).toContain("server rechecks services");
  await act(async () =>
    pressableContaining("View shop & book").props.onPress(),
  );
  expect(navigate).toHaveBeenCalledWith("SalonProfile", {
    countryCode: "IN",
    citySlug: "pune",
    salonSlug: "sample-salon",
    offerId: "offer-123",
    offerTitle: "Weekday trim",
  });
});

it("loads only the authenticated customer invoice endpoint and navigates to that invoice detail", async () => {
  const page = { items: [invoiceSummary], nextCursor: null } as InvoiceListDto;
  (apiFetch as jest.Mock).mockResolvedValue(page);
  await act(async () => {
    tree = TestRenderer.create(
      createElement(MyInvoicesScreen, { navigation: { navigate } } as never),
    );
  });

  expect(apiFetch).toHaveBeenCalledWith("invoices/mine?limit=20");
  expect(
    tree.root
      .findAll((node: any) => node.type === Text)
      .map(textOf)
      .join(" "),
  ).toContain("FQ-0001");
  await act(async () => pressableContaining("FQ-0001").props.onPress());
  expect(navigate).toHaveBeenCalledWith("InvoiceDetail", {
    invoiceId: "invoice-1",
  });
});
