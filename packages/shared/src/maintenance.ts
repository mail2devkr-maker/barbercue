/**
 * Owner request (24 Nov): while the Neon CU guard switches databases (backend stopped for a few
 * minutes), every client shows an "under maintenance" message instead of errors. The backend being
 * unreachable is the flag: a gateway error, or Railway's "Application not found" page for a service
 * with no running deployment.
 */
export const MAINTENANCE_RETRY_MS = 15_000;

export function isBackendMaintenanceResponse(status: number, bodyText: string | null | undefined): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  return status === 404 && /application not found/i.test(bodyText ?? "");
}

export const MAINTENANCE_COPY = {
  EN: {
    title: "FastQue is under maintenance",
    body: "We are upgrading our systems. Please come back in a few minutes - this page will refresh on its own.",
  },
  HI: {
    title: "FastQue अभी मेंटेनेंस में है",
    body: "हम सिस्टम अपग्रेड कर रहे हैं। कृपया कुछ मिनट बाद आइए - यह पेज अपने आप ठीक हो जाएगा।",
  },
} as const;
