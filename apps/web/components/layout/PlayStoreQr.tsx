import { QRCodeSVG } from "qrcode.react";

// The exact FastQue Android package registered with Google Play.
// A valid QR target is not proof that the Play listing has been published.
export const FASTQUE_GOOGLE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.dcw.fastque";

/**
 * Direct-to-Google-Play QR. The tiny translucent centre mark is cropped from
 * the very same owner-approved asset used in FastQue's live website header:
 * /brand/fastque-clean-lockup-transparent.png. No invented/redrawn logo,
 * white badge or opaque sticker. QR error correction H protects readability.
 */
export function PlayStoreQr({ size = 236 }: { size?: number }) {
  const markWidth = Math.round(size * 0.155);
  const scale = markWidth / 200;
  const markHeight = Math.round(144 * scale);

  return (
    <div
      role="img"
      aria-label="Scan to open FastQue on Google Play. Installation requires the app's public Play Store release."
      style={{
        position: "relative",
        width: size,
        maxWidth: "100%",
        aspectRatio: "1 / 1",
        backgroundColor: "#fff",
      }}
    >
      <QRCodeSVG
        aria-hidden="true"
        value={FASTQUE_GOOGLE_PLAY_URL}
        size={size}
        marginSize={4}
        level="H"
        fgColor="#120e15"
        bgColor="#ffffff"
        style={{ display: "block", width: "100%", height: "auto" }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: markWidth,
          height: markHeight,
          overflow: "hidden",
          opacity: 0.58,
          pointerEvents: "none",
        }}
      >
        {/* Cropping the original transparent lockup preserves the actual FQ artwork. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/fastque-clean-lockup-transparent.png"
          alt=""
          draggable={false}
          style={{
            display: "block",
            position: "absolute",
            maxWidth: "none",
            width: Math.round(958 * scale),
            height: Math.round(259 * scale),
            left: -Math.round(116 * scale),
            top: -Math.round(83 * scale),
          }}
        />
      </span>
    </div>
  );
}
