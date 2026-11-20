import { ImageResponse } from "next/og";

export const BRAND_SOCIAL_IMAGE_ALT = "FastQue — discover salons, book appointments and join live queues";
export const BRAND_SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 };

export async function createBrandSocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          background: "linear-gradient(135deg, #160b18 0%, #291326 58%, #3b1830 100%)",
          color: "#fffaf7",
          fontFamily: "Arial, sans-serif",
          textAlign: "center",
          padding: 56,
        }}
      >
        <div style={{ display: "flex", fontSize: 86, fontWeight: 700, letterSpacing: -3 }}>FastQue</div>
        <div style={{ display: "flex", fontSize: 32, color: "#f9c4ac", marginTop: 18 }}>
          Find a salon. Book your time. Join the live queue.
        </div>
      </div>
    ),
    BRAND_SOCIAL_IMAGE_SIZE,
  );
}
