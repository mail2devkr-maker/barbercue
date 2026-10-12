/// <reference types="jest" />
import { act, createElement } from "react";
import { TextInput } from "react-native";
import TestRenderer from "react-test-renderer";
import { uiStringsFor } from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { ReviewPanel } from "../ReviewPanel";

type Renderer = ReturnType<typeof TestRenderer.create>;

jest.mock("../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../lib/language-context", () => ({
  useLanguage: () => ({ t: require("@barbercue/shared").uiStringsFor("EN") }),
}));

const review = {
  id: "review-1",
  bookingId: null,
  queueEntryId: "queue-1",
  salonId: "salon-1",
  rating: 2,
  comment: "Needs a trim",
  ownerResponse: null,
  createdAt: "2026-10-11T10:00:00.000Z",
  updatedAt: "2026-10-11T10:00:00.000Z",
};

function textOf(instance: any): string {
  return instance.children
    .map((child: any) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

function findAction(renderer: Renderer, label: string) {
  return renderer.root.findAll(
    (node: any) =>
      typeof node.props.onPress === "function" && textOf(node).includes(label),
  )[0];
}

describe("Live Queue customer review panel", () => {
  let renderer: Renderer | null = null;

  afterEach(async () => {
    if (renderer) await act(async () => renderer?.unmount());
    renderer = null;
    jest.clearAllMocks();
  });

  it("prefills an existing review for editing and allows clearing its optional comment", async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ ...review, comment: null });
    const onReviewed = jest.fn();
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(ReviewPanel, {
          queueEntryId: "queue-1",
          status: "COMPLETED",
          hasReview: true,
          initialReview: review,
          title: uiStringsFor("EN").rateYourService,
          onReviewed,
        }),
      );
    });

    await act(async () => findAction(renderer!, "Edit")!.props.onPress());
    const input = renderer!.root.findByType(TextInput);
    expect(input.props.value).toBe("Needs a trim");

    await act(async () => input.props.onChangeText(""));
    await act(async () =>
      findAction(renderer!, "Save review")!.props.onPress(),
    );

    expect(apiFetch).toHaveBeenCalledWith("reviews/review-1", {
      method: "PATCH",
      body: JSON.stringify({ rating: 2, comment: "" }),
    });
    expect(onReviewed).toHaveBeenCalledWith("queue-1");
  });
});
