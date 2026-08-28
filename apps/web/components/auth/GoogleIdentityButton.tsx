"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./customer-auth.module.css";

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            use_fedcm_for_button?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** One Google Identity Services integration shared by customer, owner and staff web login. */
export function GoogleIdentityButton({
  onCredential,
  audienceLabel,
  disabled = false,
}: {
  onCredential: (idToken: string) => void;
  audienceLabel: string;
  disabled?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!ready) return;
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || !buttonRef.current || !window.google) return;
    buttonRef.current.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => callbackRef.current(response.credential),
      use_fedcm_for_button: true,
    });
    const width = Math.min(buttonRef.current.offsetWidth || 320, 400);
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      width,
      text: "continue_with",
    });
  }, [ready]);

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setReady(true)}
        onReady={() => setReady(true)}
      />
      <div
        ref={buttonRef}
        className={styles.googleButton}
        aria-label={`Continue with Google as ${audienceLabel}`}
        aria-disabled={disabled}
        style={disabled ? { opacity: 0.6, pointerEvents: "none" } : undefined}
      />
    </>
  );
}
