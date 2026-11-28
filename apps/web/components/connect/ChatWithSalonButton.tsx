"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectApi, connectErrorText, connectLinksEnabled } from "../../lib/connect";

/**
 * "Chat with Salon" for a booking, live queue visit or home booking. Renders nothing while
 * FastQue Connect is off. The server checks the booking belongs to the signed-in customer.
 */
type Props = {
  bookingId?: string;
  queueEntryId?: string;
  homeBookingId?: string;
  homeBookingCode?: string;
  className?: string;
  label?: string;
};

/** Nothing (not even a router hook) is mounted while FastQue Connect is off. */
export function ChatWithSalonButton(props: Props) {
  if (!connectLinksEnabled() || !(props.bookingId || props.queueEntryId || props.homeBookingId || props.homeBookingCode)) return null;
  return <ChatButton {...props} />;
}

function ChatButton({
  bookingId,
  queueEntryId,
  homeBookingId,
  homeBookingCode,
  className,
  label = "Chat with Salon",
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await connectApi<{ id: string }>("me/conversations", "POST", bookingId ? { bookingId } : queueEntryId ? { queueEntryId } : homeBookingId ? { homeBookingId } : { homeBookingCode });
            router.push(`/account/messages?c=${r.id}`);
          } catch (e) {
            setError(connectErrorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        💬 {label}
      </button>
      {error && <span role="alert" style={{ fontSize: "0.8rem", color: "#b3261e" }}>{error}</span>}
    </>
  );
}
