import {
  expect,
  test,
  type BrowserContext,
  type Dialog,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { generate } from "otplib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type Account = { id: string; email: string; password: string; secret?: string };
type BrowserFixtures = {
  version: 1;
  now: number;
  accounts: {
    superAdmin: Account & { secret: string };
    coFounder: Account & { secret: string };
    salesAdmin: Account & { secret: string };
    viewer: Account & { secret: string };
    shopOwner: Account;
  };
  shop: {
    id: string;
    publicId: string;
    name: string;
    slug: string;
    countryCode: string;
    citySlug: string;
    queueToken: string;
  };
  expiredShop: { id: string; name: string; publicId: string };
  history: {
    bookingId: string;
    paymentId: string;
    refundId: string;
    ledgerId: string;
    subsidyId: string;
  };
};

const fixturePath = process.env.PR168_BROWSER_FIXTURE_FILE;
const clockPath = process.env.PR168_TEST_CLOCK_FILE;
const fixtures =
  fixturePath && existsSync(fixturePath)
    ? (JSON.parse(readFileSync(fixturePath, "utf8")) as BrowserFixtures)
    : ({
        version: 1,
        now: 1,
        accounts: {
          superAdmin: { id: "", email: "", password: "", secret: "" },
          coFounder: { id: "", email: "", password: "", secret: "" },
          salesAdmin: { id: "", email: "", password: "", secret: "" },
          viewer: { id: "", email: "", password: "", secret: "" },
          shopOwner: { id: "", email: "", password: "" },
        },
        shop: {
          id: "",
          publicId: "",
          name: "",
          slug: "",
          countryCode: "ZZ",
          citySlug: "",
          queueToken: "",
        },
        expiredShop: { id: "", name: "", publicId: "" },
        history: {
          bookingId: "",
          paymentId: "",
          refundId: "",
          ledgerId: "",
          subsidyId: "",
        },
      } as BrowserFixtures);
const baseURL = process.env.PR168_WEB_URL ?? "http://127.0.0.1:30168";
const profilePath = `/${fixtures.shop.countryCode.toLowerCase()}/${fixtures.shop.citySlug}/${fixtures.shop.slug}`;
const cityDiscoveryPath = `/${fixtures.shop.countryCode.toLowerCase()}/${fixtures.shop.citySlug}`;
const bookPath = `/book/${fixtures.shop.slug}?city=${encodeURIComponent(fixtures.shop.citySlug)}&country=${encodeURIComponent(fixtures.shop.countryCode)}`;
const qrQueuePath = `/q/${encodeURIComponent(fixtures.shop.queueToken)}`;
const reason =
  "Synthetic browser certification request; no shop data is deleted.";
let simulatedNow = fixtures.now;
const ADMIN_LOGIN_THROTTLE_WINDOW_MS = 60_000;

async function waitForAdminLoginThrottleWindow() {
  // The backend's controlled Date drives TOTP/recovery time, but Nest's in-memory
  // throttler releases hits with real setTimeout callbacks. Wait for that actual
  // production window rather than bypassing or weakening the login throttle.
  await new Promise((resolve) =>
    setTimeout(resolve, ADMIN_LOGIN_THROTTLE_WINDOW_MS + 1_000),
  );
}

function record(condition: unknown, message: string) {
  assertionCount += 1;
  expect(Boolean(condition), message).toBe(true);
}

let assertionCount = 0;

async function clickWithDialog(
  page: Page,
  locator: Locator,
): Promise<{ dialog: Dialog; clickPromise: Promise<void> }> {
  await expect(locator, "Confirmation control is enabled before interaction").toBeEnabled();
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  const dialogPromise = page.waitForEvent("dialog", { timeout: 10_000 });
  const clickPromise = locator.click();
  try {
    const first = await Promise.race([
      dialogPromise.then((dialog) => ({ dialog })),
      clickPromise.then(() => ({ clickCompleted: true as const })),
    ]);
    if ("dialog" in first) return { dialog: first.dialog, clickPromise };

    // A click can resolve just before Chromium dispatches the native dialog event. Keep waiting
    // for the armed event instead of treating promise ordering as proof that no dialog opened.
    const dialog = await dialogPromise;
    return { dialog, clickPromise };
  } catch (error) {
    await dialogPromise.catch(() => undefined);
    const [documentState, controlState] = await Promise.all([
      page
        .evaluate(() => ({ focused: document.hasFocus(), visibility: document.visibilityState }))
        .catch(() => ({ focused: false, visibility: "unavailable" })),
      locator
        .evaluate((element) => ({
          disabled: (element as HTMLButtonElement).disabled,
          label: element.textContent?.trim() ?? "",
        }))
        .catch(() => ({ disabled: true, label: "unavailable" })),
    ]);
    throw new Error(
      `Confirmation dialog did not open (${error instanceof Error ? error.message : "unknown error"}); document=${JSON.stringify(documentState)}; control=${JSON.stringify(controlState)}`,
      { cause: error },
    );
  }
}

async function visible(locator: Locator, message: string) {
  assertionCount += 1;
  await expect(locator, message).toBeVisible();
}

async function absent(locator: Locator, message: string) {
  assertionCount += 1;
  await expect(locator, message).toHaveCount(0);
}

async function contains(
  locator: Locator,
  text: string | RegExp,
  message: string,
) {
  assertionCount += 1;
  await expect(locator, message).toContainText(text);
}

async function exactURL(page: Page, pattern: RegExp, message: string) {
  assertionCount += 1;
  await expect(page, message).toHaveURL(pattern);
}

async function disabled(locator: Locator, message: string) {
  assertionCount += 1;
  await expect(locator, message).toBeDisabled();
}

function visibleAlert(page: Page) {
  // Next.js contributes an empty route-announcer with role=alert; target only application text.
  return page.locator('[role="alert"]').filter({ hasText: /\S/ }).first();
}

function advanceClock(milliseconds = 31_000) {
  // Advance by more than one TOTP interval while leaving all newly-created recovery windows open.
  simulatedNow += milliseconds;
  writeFileSync(clockPath as string, String(simulatedNow), {
    encoding: "utf8",
    mode: 0o600,
  });
  return simulatedNow;
}

async function totpAt(secret: string, epochMs: number) {
  const realNow = Date.now;
  Date.now = () => epochMs;
  try {
    return await generate({ secret });
  } finally {
    Date.now = realNow;
  }
}

async function wrongTotp(secret: string) {
  const valid = Number(await totpAt(secret, simulatedNow));
  return String((valid + 1) % 1_000_000).padStart(6, "0");
}

async function pauseBrowserResponseUntilReleased(page: Page, path: string) {
  let release!: () => void;
  let resolveIntercepted!: () => void;
  let resolveCommittedStatus!: (status: number) => void;
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    resolveIntercepted = resolve;
  });
  const committedStatus = new Promise<number>((resolve) => {
    resolveCommittedStatus = resolve;
  });
  let requestCount = 0;
  const urlPattern = `**${path}`;
  const handler = async (route: Route) => {
    requestCount += 1;
    resolveIntercepted();
    await releasePromise;
    const response = await route.fetch();
    resolveCommittedStatus(response.status());
    await route.fulfill({ response });
  };
  await page.route(urlPattern, handler);
  return {
    intercepted,
    committedStatus,
    release,
    requestCount: () => requestCount,
    remove: () => page.unroute(urlPattern, handler),
  };
}

async function loginAdmin(page: Page, account: Account & { secret: string }) {
  await page.goto("/admin/login");
  await visible(
    page.getByRole("heading", { name: "Platform admin sign in" }),
    "Admin login page loads",
  );
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);

  const challengePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/auth/admin/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in securely" }).click();
  const challenge = await challengePromise;
  record(
    challenge.status() === 401,
    "Password-only admin login receives a TOTP challenge",
  );
  await contains(
    visibleAlert(page),
    /6-digit code/i,
    "Admin UI explains the required authenticator step",
  );

  const epoch = advanceClock();
  await page
    .getByLabel("Authenticator code")
    .fill(await totpAt(account.secret, epoch));
  const loginPromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/auth/admin/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in securely" }).click();
  const login = await loginPromise;
  const retryAfter = login.headers()["retry-after"];
  const loginFailureContext = `HTTP ${login.status()}${retryAfter ? `, retry after ${retryAfter}s` : ""}`;
  record(
    login.status() === 201,
    `Fresh password + TOTP login succeeds through the real web form (${loginFailureContext})`,
  );
  const result = (await login.json()) as { tokens?: { accessToken?: string } };
  const token = result.tokens?.accessToken;
  record(
    typeof token === "string" && token.length > 30,
    "Successful login creates an authenticated session",
  );
  await exactURL(
    page,
    /\/dashboard\/admin$/,
    "Admin login reaches the real operations dashboard",
  );
  await visible(
    page.getByRole("heading", { name: "Platform operations" }),
    "Operations dashboard renders after login",
  );
  return token as string;
}

async function loginOwner(page: Page, account: Account) {
  await page.goto("/owner/login");
  await visible(
    page.getByRole("heading", { name: "Shop owner sign in" }),
    "Owner login page loads",
  );
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  const loginPromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/auth/staff/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  const login = await loginPromise;
  record(
    login.status() === 201,
    "Synthetic shop owner logs in through the actual owner UI",
  );
  const result = (await login.json()) as { tokens?: { accessToken?: string } };
  const token = result.tokens?.accessToken;
  record(
    typeof token === "string" && token.length > 30,
    "Owner login creates a separate authenticated session",
  );
  await exactURL(
    page,
    /\/dashboard\/salons(?:\/|$)/,
    "Owner is routed only to the salon workspace",
  );
  return token as string;
}

async function protectedRequestStatus(
  page: Page,
  token: string,
  endpoint: string,
  method: "GET" | "POST",
  body?: Record<string, string>,
) {
  const result = await page.evaluate(
    async ({
      token: bearer,
      endpoint: requestPath,
      method: requestMethod,
      body: requestBody,
    }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(requestBody ? { "content-type": "application/json" } : {}),
        },
        ...(requestBody ? { body: JSON.stringify(requestBody) } : {}),
      });
      const text = await response.text();
      return {
        status: response.status,
        leaksInternalStack:
          /\bat (?:Object|async|new)\b|PrismaClientKnownRequestError|node_modules[\\/]/i.test(
            text,
          ),
      };
    },
    { token, endpoint, method, body },
  );
  record(
    result.leaksInternalStack === false,
    "Denied browser API response does not expose an internal stack",
  );
  return result.status;
}

async function assertNoBrowserSecrets(
  page: Page,
  account: Account & { secret?: string },
  token: string,
) {
  const safe = await page.evaluate(() => {
    const values = [
      ...Object.keys(localStorage).map(
        (key) => `${key}=${localStorage.getItem(key) ?? ""}`,
      ),
      ...Object.keys(sessionStorage).map(
        (key) => `${key}=${sessionStorage.getItem(key) ?? ""}`,
      ),
    ];
    const jwt = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
    return !values.some(
      (value) => /access.?token|refresh.?token/i.test(value) || jwt.test(value),
    );
  });
  record(safe, "Browser storage does not persist bearer or refresh tokens");
  const bodyText = await page.locator("body").innerText();
  record(
    !bodyText.includes(account.password),
    "Rendered page does not expose the password",
  );
  record(
    !account.secret || !bodyText.includes(account.secret),
    "Rendered page does not expose the TOTP seed",
  );
  record(
    !bodyText.includes(token),
    "Rendered page does not expose the access token",
  );
}

async function routeWithAuth(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test("real Chromium certifies PR #168 request, approval, quarantine, restoration and role boundaries", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  test.skip(
    !fixturePath || !clockPath || !existsSync(fixturePath),
    "requires private disposable PostgreSQL fixtures from the certification workflow",
  );
  const coContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  const viewerContext = await browser.newContext({ baseURL });
  const salesContext = await browser.newContext({ baseURL });
  const ownerContext = await browser.newContext({ baseURL });
  const anonymousContext = await browser.newContext({ baseURL });

  try {
    const coPage = await coContext.newPage();
    const coToken = await loginAdmin(coPage, fixtures.accounts.coFounder);
    await assertNoBrowserSecrets(coPage, fixtures.accounts.coFounder, coToken);
    const coCookies = await coContext.cookies(baseURL);
    record(
      coCookies.some((cookie) => cookie.httpOnly && cookie.path === "/"),
      "Refresh session is held in an HttpOnly cookie",
    );
    await absent(
      coPage.getByRole("link", { name: /Security & audit/ }),
      "Co-Founder dashboard does not advertise the Super Admin security console",
    );

    await coPage.reload();
    await visible(
      coPage.getByRole("heading", { name: "Platform operations" }),
      "HttpOnly refresh cookie restores the authenticated browser session after reload",
    );
    const shopSearch = coPage.getByLabel(
      "Search shops, IDs, people or contact",
    );
    await shopSearch.fill(fixtures.shop.name);
    const shopRow = coPage
      .getByRole("row")
      .filter({ hasText: fixtures.shop.name });
    await visible(
      shopRow.getByRole("button", { name: "Request deletion" }),
      "Co-Founder can access the request action for the selected shop",
    );
    await absent(
      shopRow.getByRole("button", { name: /Move to Trash|Restore shop/ }),
      "Co-Founder has no approval or restore control",
    );

    const publicContext = await browser.newContext({ baseURL });
    const publicPage = await publicContext.newPage();
    try {
      await publicPage.goto(profilePath);
      await visible(
        publicPage.getByRole("heading", { name: fixtures.shop.name }),
        "Active shop profile is visible before quarantine",
      );
      await visible(
        publicPage.getByRole("link", { name: "Book an appointment" }),
        "Active shop exposes its booking destination",
      );
      await visible(
        publicPage.getByRole("link", { name: "Join live queue" }),
        "Active shop exposes its queue destination",
      );
      const cityPage = await publicContext.newPage();
      await cityPage.goto(cityDiscoveryPath);
      await visible(
        cityPage.getByRole("link", {
          name: `View ${fixtures.shop.name}`,
        }),
        "Active shop is present in the public city discovery page",
      );
    } finally {
      await publicContext.close();
    }

    const { dialog: emptyPrompt, clickPromise: emptyPromptClick } =
      await clickWithDialog(
        coPage,
        shopRow.getByRole("button", { name: "Request deletion" }),
      );
    record(
      emptyPrompt.type() === "prompt" &&
        emptyPrompt.message().includes("Nothing is deleted now"),
      "Request prompt clearly explains that no deletion happens immediately",
    );
    await emptyPrompt.accept("");
    await emptyPromptClick;
    await contains(
      visibleAlert(coPage),
      "Provide a reason between 10 and 500 characters.",
      "Empty reason is rejected in the UI",
    );

    const { dialog: cancelPrompt, clickPromise: cancelPromptClick } =
      await clickWithDialog(
        coPage,
        shopRow.getByRole("button", { name: "Request deletion" }),
      );
    await cancelPrompt.dismiss();
    await cancelPromptClick;
    await absent(
      coPage.getByRole("status"),
      "Canceling the request prompt does not display a false-success status",
    );

    const requestPromise = coPage.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/v1/admin/shops/${fixtures.shop.id}/deletion-requests`,
          ) && response.request().method() === "POST",
    );
    const { dialog: requestDialog, clickPromise: requestClick } =
      await clickWithDialog(
        coPage,
        shopRow.getByRole("button", { name: "Request deletion" }),
      );
    record(
      requestDialog.type() === "prompt",
      "Valid deletion request uses the real browser prompt",
    );
    await requestDialog.accept(reason);
    await requestClick;
    const requestResponse = await requestPromise;
    record(
      requestResponse.status() === 201,
      "Co-Founder UI creates the pending deletion request through the real API",
    );
    const requestJson = (await requestResponse.json()) as { id?: string };
    record(
      typeof requestJson.id === "string",
      "Request response contains a durable request ID",
    );
    const requestId = requestJson.id as string;
    await contains(
      coPage.getByRole("status"),
      /Approval request submitted.*Shop remains unchanged/,
      "The UI reports server-confirmed pending submission without claiming quarantine",
    );

    const duplicatePromise = coPage.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/v1/admin/shops/${fixtures.shop.id}/deletion-requests`,
          ) && response.request().method() === "POST",
    );
    const { dialog: duplicatePrompt, clickPromise: duplicateClick } =
      await clickWithDialog(
        coPage,
        shopRow.getByRole("button", { name: "Request deletion" }),
      );
    await duplicatePrompt.accept(reason);
    await duplicateClick;
    const duplicateResponse = await duplicatePromise;
    record(
      duplicateResponse.status() === 409,
      "Duplicate pending request is rejected by the server",
    );
    await contains(
      visibleAlert(coPage),
      /already awaiting Super Admin approval/i,
      "Duplicate request error is visible to the requester",
    );

    await coPage.goto("/dashboard/admin/security");
    await visible(
      coPage.getByRole("heading", { name: "Super Admin only" }),
      "Co-Founder direct navigation is explicitly denied by the security page",
    );
    await visible(
      coPage.getByText("Access denied."),
      "Co-Founder receives a clear access-denied explanation",
    );
    await absent(
      coPage.getByRole("button", { name: /Move to Trash|Restore shop/ }),
      "No privileged mutation controls render for Co-Founder",
    );
    const coTotp = await totpAt(
      fixtures.accounts.superAdmin.secret,
      simulatedNow,
    );
    const selfApprovalStatus = await protectedRequestStatus(
      coPage,
      coToken,
      `/api/v1/admin/security/deletion-requests/${requestId}/approve`,
      "POST",
      { totpCode: coTotp, note: "" },
    );
    record(
      selfApprovalStatus === 403,
      "Co-Founder cannot approve through a direct authenticated browser API request",
    );

    // Admin login is intentionally rate-limited to five attempts per minute. Move only the
    // disposable server clock past that window between independent synthetic identities; do not
    // disable or relax the production throttle.
    advanceClock(60_001);
    const adminPage = await adminContext.newPage();
    const adminToken = await loginAdmin(
      adminPage,
      fixtures.accounts.superAdmin,
    );
    await assertNoBrowserSecrets(
      adminPage,
      fixtures.accounts.superAdmin,
      adminToken,
    );
    const adminCookies = await adminContext.cookies(baseURL);
    record(
      adminCookies.some((cookie) => cookie.httpOnly && cookie.path === "/"),
      "Super Admin refresh token is stored only in an HttpOnly cookie",
    );
    await visible(
      adminPage.getByRole("link", { name: /Security & audit/ }),
      "Super Admin dashboard exposes Security & audit",
    );
    await adminPage.getByRole("link", { name: /Security & audit/ }).click();
    await visible(
      adminPage.getByRole("heading", {
        name: "Security & Audit Control Center",
      }),
      "Super Admin reaches the actual security console",
    );
    const pendingSection = adminPage.getByRole("region", {
      name: "Pending deletion approvals",
    });
    const pendingRow = pendingSection
      .getByRole("row")
      .filter({ hasText: fixtures.shop.name });
    await visible(
      pendingRow,
      "New Co-Founder request appears in the Super Admin pending queue",
    );
    await contains(
      pendingRow,
      fixtures.shop.publicId,
      "Approval queue shows the correct public shop identifier",
    );
    await contains(
      pendingRow,
      fixtures.accounts.coFounder.email,
      "Approval queue attributes the requester",
    );
    const approveButton = pendingRow.getByRole("button", {
      name: "Move to Trash — recoverable for 30 days",
    });
    await disabled(
      approveButton,
      "Approval is unavailable until details have been reviewed",
    );
    await pendingRow
      .getByRole("button", { name: "Review request details" })
      .click();
    await visible(
      adminPage.getByRole("heading", {
        name: `Request details — ${fixtures.shop.name}`,
      }),
      "Super Admin can open request details",
    );
    await contains(
      adminPage.getByRole("region", {
        name: `Request details — ${fixtures.shop.name}`,
      }),
      reason,
      "Request reason is shown only in authorized detail view",
    );
    assertionCount += 1;
    await expect(approveButton).toBeEnabled();

    await approveButton.click();
    await contains(
      visibleAlert(adminPage),
      /6-digit Super Admin authenticator code/i,
      "Approval without TOTP is rejected before a request is sent",
    );
    advanceClock();
    await pendingRow
      .getByLabel("Current Super Admin authenticator code")
      .fill(await wrongTotp(fixtures.accounts.superAdmin.secret));
    const badApprovalPromise = adminPage.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/v1/admin/security/deletion-requests/${requestId}/approve`,
          ) && response.request().method() === "POST",
    );
    const { dialog: badConfirm, clickPromise: badApprovalClick } =
      await clickWithDialog(adminPage, approveButton);
    await badConfirm.accept();
    await badApprovalClick;
    const badApproval = await badApprovalPromise;
    record(
      badApproval.status() === 401 || badApproval.status() === 403,
      "Invalid fresh TOTP is rejected server-side",
    );
    await visible(
      visibleAlert(adminPage),
      "Invalid TOTP error is announced in the browser UI",
    );
    await visible(pendingRow, "Invalid TOTP leaves the request pending");
    await absent(
      adminPage.getByRole("status").filter({ hasText: /moved to Trash/ }),
      "Invalid TOTP never displays a false quarantine success",
    );

    // Use a fresh authenticated tab for the cancel case. Chromium may suppress repeated native
    // dialogs in one tab during a long test; the same HttpOnly session is restored in this tab.
    const cancelApprovalPage = await adminContext.newPage();
    try {
      await cancelApprovalPage.goto("/dashboard/admin/security");
      await visible(
        cancelApprovalPage.getByRole("heading", {
          name: "Security & Audit Control Center",
        }),
        "Super Admin session restores in a separate tab for confirmation-cancel testing",
      );
      const cancelPendingSection = cancelApprovalPage.getByRole("region", {
        name: "Pending deletion approvals",
      });
      const cancelPendingRow = cancelPendingSection
        .getByRole("row")
        .filter({ hasText: fixtures.shop.name });
      await visible(cancelPendingRow, "Pending request remains after invalid TOTP");
      await cancelPendingRow
        .getByRole("button", { name: "Review request details" })
        .click();
      await visible(
        cancelApprovalPage.getByRole("heading", {
          name: `Request details — ${fixtures.shop.name}`,
        }),
        "Cancellation tab opens the real request details",
      );
      const cancelApproveButton = cancelPendingRow.getByRole("button", {
        name: "Move to Trash — recoverable for 30 days",
      });
      const cancelEpoch = advanceClock();
      await cancelPendingRow
        .getByLabel("Current Super Admin authenticator code")
        .fill(await totpAt(fixtures.accounts.superAdmin.secret, cancelEpoch));
      await expect(
        cancelApproveButton,
        "Approval control is enabled after a valid six-digit TOTP is entered",
      ).toBeEnabled();
      const { dialog: cancelConfirm, clickPromise: cancelApprovalClick } =
        await clickWithDialog(cancelApprovalPage, cancelApproveButton);
      await cancelConfirm.dismiss();
      await cancelApprovalClick;
      await visible(
        cancelPendingRow,
        "Canceling approval confirmation leaves the request pending",
      );
      await absent(
        cancelApprovalPage
          .getByRole("status")
          .filter({ hasText: /moved to Trash/ }),
        "Canceling approval never announces a mutation",
      );
    } finally {
      await cancelApprovalPage.close();
    }

    const validApprovalEpoch = advanceClock();
    await pendingRow
      .getByLabel("Current Super Admin authenticator code")
      .fill(
        await totpAt(fixtures.accounts.superAdmin.secret, validApprovalEpoch),
      );
    const approvalPath = `/api/v1/admin/security/deletion-requests/${requestId}/approve`;
    const approvalPromise = adminPage.waitForResponse(
      (response) =>
        response.url().includes(approvalPath) &&
        response.request().method() === "POST",
    );
    const approvalGate = await pauseBrowserResponseUntilReleased(
      adminPage,
      approvalPath,
    );
    try {
      const { dialog: approvalDialog, clickPromise: approvalClick } =
        await clickWithDialog(adminPage, approveButton);
      record(
        approvalDialog.type() === "confirm" &&
          /30 full days/.test(approvalDialog.message()) &&
          /No records or assets will be permanently deleted/.test(
            approvalDialog.message(),
          ),
        "Approval confirmation accurately states recoverability and no permanent deletion",
      );
      await approvalDialog.accept();
      await approvalClick;
      await approvalGate.intercepted;
      const approvalInFlight = pendingRow.getByRole("button", {
        name: "Processing…",
      });
      await visible(
        approvalInFlight,
        "Approval action switches to its in-flight label",
      );
      await disabled(
        approvalInFlight,
        "Approval control is disabled while its authoritative request is pending",
      );
      await approvalInFlight.evaluate((button: HTMLButtonElement) =>
        button.click(),
      );
      record(
        approvalGate.requestCount() === 1,
        "A repeated click cannot send a duplicate approval mutation",
      );
      approvalGate.release();
      const committedStatus = await approvalGate.committedStatus;
      record(
        committedStatus === 201,
        "Disposable backend commits the approval after the browser control locks",
      );
    } finally {
      approvalGate.release();
      await approvalGate.remove();
    }
    const approvalResponse = await approvalPromise;
    record(
      approvalResponse.status() === 201,
      "Super Admin approval commits through the real UI request",
    );
    await contains(
      adminPage.getByRole("status"),
      /moved to Trash.*Restore is available until/i,
      "Success appears only with the server-returned recovery deadline",
    );
    await absent(
      pendingSection.getByRole("row").filter({ hasText: fixtures.shop.name }),
      "Approved request leaves the pending queue",
    );

    const trashSection = adminPage.getByRole("region", {
      name: "Recoverable shop trash",
    });
    const trashRow = trashSection
      .getByRole("row")
      .filter({ hasText: fixtures.shop.name });
    await visible(
      trashRow,
      "Quarantined shop appears in the actual recovery Trash UI",
    );
    await contains(
      trashRow,
      fixtures.shop.publicId,
      "Trash preserves the original public shop identifier",
    );
    await contains(
      trashRow,
      "Before: ACTIVE",
      "Trash shows the prior shop status",
    );
    await contains(trashRow, "Until", "Trash shows the recovery deadline");
    const expiredRow = trashSection
      .getByRole("row")
      .filter({ hasText: fixtures.expiredShop.name });
    await contains(
      expiredRow,
      "Expired — read-only",
      "Expired shop remains available for audit in read-only Trash",
    );
    await disabled(
      expiredRow.getByRole("button", { name: "Restore shop" }),
      "Expired recovery control is disabled",
    );

    const publicAfterApproval = await anonymousContext.newPage();
    try {
      const profileApiResponse = await publicAfterApproval.request.get(
        `${baseURL}/api/v1/salons/${fixtures.shop.countryCode}/${fixtures.shop.citySlug}/${fixtures.shop.slug}`,
      );
      record(
        profileApiResponse.status() === 404,
        "Anonymous public profile API returns 404 after quarantine",
      );
      const profileResponse = await publicAfterApproval.goto(profilePath);
      console.log(
        `Public profile document returned HTTP ${profileResponse?.status() ?? "no response"} after quarantine.`,
      );
      record(
        profileResponse !== null,
        "Direct public shop URL completes browser navigation after quarantine",
      );
      await visible(
        publicAfterApproval.getByRole("heading", { name: "This chair is empty." }),
        "Direct public shop URL renders the site's not-found state after quarantine",
      );
      await absent(
        publicAfterApproval.getByRole("heading", { name: fixtures.shop.name }),
        "Quarantined shop name is absent from direct profile output",
      );
      await absent(
        publicAfterApproval.getByRole("link", { name: "Book an appointment" }),
        "Booking CTA is absent after quarantine",
      );
      await absent(
        publicAfterApproval.getByRole("link", { name: "Join live queue" }),
        "Queue CTA is absent after quarantine",
      );

      await publicAfterApproval.goto(cityDiscoveryPath);
      await absent(
        publicAfterApproval.getByText(fixtures.shop.name),
        "Previously warmed public city discovery no longer lists the quarantined shop",
      );

      const bookResponse = await publicAfterApproval.goto(bookPath);
      record(
        bookResponse !== null,
        "Direct customer booking route completes navigation after quarantine",
      );
      await visible(
        publicAfterApproval.getByRole("heading", { name: "This chair is empty." }),
        "Direct customer booking route renders the not-found state after quarantine",
      );
      await absent(
        publicAfterApproval.getByRole("heading", {
          name: `Book at ${fixtures.shop.name}`,
        }),
        "Booking page does not expose a quarantined shop",
      );

      await publicAfterApproval.goto(qrQueuePath);
      await contains(
        publicAfterApproval.locator("body"),
        /queue link is no longer available|queue is currently unavailable/i,
        "Queue token page reports quarantine as unavailable",
      );
      await absent(
        publicAfterApproval.getByRole("button", { name: /join.*queue/i }),
        "Customer cannot submit a queue join from the quarantined shop",
      );

      await publicAfterApproval.goto(
        `/queue/${fixtures.shop.slug}?city=${encodeURIComponent(fixtures.shop.citySlug)}&country=${encodeURIComponent(fixtures.shop.countryCode)}`,
      );
      await absent(
        publicAfterApproval.getByRole("button", { name: /join.*queue/i }),
        "Slug-based queue route cannot join a quarantined shop",
      );
    } finally {
      await publicAfterApproval.close();
    }

    const restoreCode = trashRow.getByLabel(
      "Current Super Admin authenticator code",
    );
    const restoreButton = trashRow.getByRole("button", {
      name: "Restore shop",
    });
    await restoreCode.fill("");
    await restoreButton.click();
    await contains(
      visibleAlert(adminPage),
      /6-digit Super Admin authenticator code/i,
      "Restore without TOTP is rejected in the UI",
    );

    advanceClock();
    await restoreCode.fill(
      await wrongTotp(fixtures.accounts.superAdmin.secret),
    );
    const badRestorePromise = adminPage.waitForResponse(
      (response) =>
        response
          .url()
          .includes(
            `/api/v1/admin/security/deletion-trash/${fixtures.shop.id}/restore`,
          ) && response.request().method() === "POST",
    );
    const { dialog: badRestoreConfirm, clickPromise: badRestoreClick } =
      await clickWithDialog(adminPage, restoreButton);
    await badRestoreConfirm.accept();
    await badRestoreClick;
    const badRestore = await badRestorePromise;
    record(
      badRestore.status() === 401 || badRestore.status() === 403,
      "Invalid restoration TOTP is rejected server-side",
    );
    await visible(
      visibleAlert(adminPage),
      "Invalid restoration TOTP is shown without success",
    );
    await absent(
      adminPage.getByRole("status").filter({ hasText: /restored with status/ }),
      "Invalid restoration never displays false success",
    );

    const cancelRestorePage = await adminContext.newPage();
    try {
      await cancelRestorePage.goto("/dashboard/admin/security");
      await visible(
        cancelRestorePage.getByRole("heading", {
          name: "Security & Audit Control Center",
        }),
        "Super Admin session restores in a separate tab for restoration-cancel testing",
      );
      const cancelTrashSection = cancelRestorePage.getByRole("region", {
        name: "Recoverable shop trash",
      });
      const cancelTrashRow = cancelTrashSection
        .getByRole("row")
        .filter({ hasText: fixtures.shop.name });
      await visible(cancelTrashRow, "Quarantined shop remains restorable");
      const cancelRestoreCode = cancelTrashRow.getByLabel(
        "Current Super Admin authenticator code",
      );
      const cancelRestoreButton = cancelTrashRow.getByRole("button", {
        name: "Restore shop",
      });
      const cancelRestoreEpoch = advanceClock();
      await cancelRestoreCode.fill(
        await totpAt(fixtures.accounts.superAdmin.secret, cancelRestoreEpoch),
      );
      const { dialog: restoreCancel, clickPromise: cancelRestoreClick } =
        await clickWithDialog(cancelRestorePage, cancelRestoreButton);
      record(
        restoreCancel.type() === "confirm" &&
          /readiness and verification are checked/.test(restoreCancel.message()),
        "Restore confirmation explains prior-status/readiness rules",
      );
      await restoreCancel.dismiss();
      await cancelRestoreClick;
      await visible(cancelTrashRow, "Canceling restoration leaves shop in Trash");
      await absent(
        cancelRestorePage
          .getByRole("status")
          .filter({ hasText: /restored with status/ }),
        "Canceling restoration never announces success",
      );
    } finally {
      await cancelRestorePage.close();
    }

    const validRestoreEpoch = advanceClock();
    await restoreCode.fill(
      await totpAt(fixtures.accounts.superAdmin.secret, validRestoreEpoch),
    );
    const restorePath = `/api/v1/admin/security/deletion-trash/${fixtures.shop.id}/restore`;
    const restorePromise = adminPage.waitForResponse(
      (response) =>
        response.url().includes(restorePath) &&
        response.request().method() === "POST",
    );
    const restoreGate = await pauseBrowserResponseUntilReleased(
      adminPage,
      restorePath,
    );
    try {
      const { dialog: restoreDialog, clickPromise: restoreClick } =
        await clickWithDialog(adminPage, restoreButton);
      await restoreDialog.accept();
      await restoreClick;
      await restoreGate.intercepted;
      const restorationInFlight = trashRow.getByRole("button", {
        name: "Restoring…",
      });
      await visible(
        restorationInFlight,
        "Restore action switches to its in-flight label",
      );
      await disabled(
        restorationInFlight,
        "Restore control is disabled while its authoritative request is pending",
      );
      await restorationInFlight.evaluate((button: HTMLButtonElement) =>
        button.click(),
      );
      record(
        restoreGate.requestCount() === 1,
        "A repeated click cannot send a duplicate restoration mutation",
      );
      restoreGate.release();
      const committedStatus = await restoreGate.committedStatus;
      record(
        committedStatus === 201,
        "Disposable backend commits restoration after the browser control locks",
      );
    } finally {
      restoreGate.release();
      await restoreGate.remove();
    }
    const restoreResponse = await restorePromise;
    record(
      restoreResponse.status() === 201,
      "Super Admin restores the shop through the real browser UI",
    );
    await contains(
      adminPage.getByRole("status"),
      /restored with status ACTIVE/i,
      "Restoration success reflects the server-returned safe status",
    );
    await absent(
      trashSection.getByRole("row").filter({ hasText: fixtures.shop.name }),
      "Restored shop leaves recovery Trash",
    );
    const restoredAuditRow = adminPage
      .getByRole("row")
      .filter({ hasText: fixtures.shop.id })
      .filter({ has: adminPage.getByText("SHOP_DELETE_RESTORED") });
    await visible(
      restoredAuditRow.first().getByText("SHOP_DELETE_RESTORED"),
      "Audit history records restoration for this shop in the browser view",
    );

    const restoredPublicContext = await browser.newContext({ baseURL });
    const publicAfterRestore = await restoredPublicContext.newPage();
    try {
      const restoredProfile = await publicAfterRestore.goto(profilePath);
      record(
        restoredProfile?.status() === 200,
        "Restored active shop profile returns successfully",
      );
      await visible(
        publicAfterRestore.getByRole("heading", { name: fixtures.shop.name }),
        "Restored shop is visible again on its original public URL",
      );
      await visible(
        publicAfterRestore.getByRole("link", { name: "Book an appointment" }),
        "Restored shop booking CTA follows restored status",
      );
      await publicAfterRestore.goto(qrQueuePath);
      await visible(
        publicAfterRestore.getByText("Join the queue for your next visit."),
        "Restored shop queue page is usable again",
      );
    } finally {
      await restoredPublicContext.close();
    }

    advanceClock(60_001);
    await waitForAdminLoginThrottleWindow();
    const viewerPage = await viewerContext.newPage();
    const viewerToken = await loginAdmin(viewerPage, fixtures.accounts.viewer);
    await contains(
      viewerPage
        .getByRole("status")
        .filter({ hasText: /read-only access/i }),
      /read-only access/i,
      "Platform Viewer sees the read-only warning",
    );
    await contains(
      viewerPage.getByRole("row").filter({ hasText: fixtures.shop.name }),
      "No shop actions",
      "Viewer shop row exposes no mutation controls",
    );
    await absent(
      viewerPage.getByRole("link", { name: /Security & audit/ }),
      "Viewer has no Security & audit navigation",
    );
    await viewerPage.goto("/dashboard/admin/security");
    await exactURL(
      viewerPage,
      /\/dashboard\/admin$/,
      "Viewer direct security URL is redirected to the permitted overview",
    );
    await absent(
      viewerPage.getByRole("heading", {
        name: "Security & Audit Control Center",
      }),
      "Viewer cannot render Super Admin security data",
    );
    const viewerApiStatus = await protectedRequestStatus(
      viewerPage,
      viewerToken,
      "/api/v1/admin/security/deletion-trash",
      "GET",
    );
    record(
      viewerApiStatus === 403,
      "Viewer browser session is rejected by the protected API, not only hidden by the UI",
    );
    const viewerRestoreStatus = await protectedRequestStatus(
      viewerPage,
      viewerToken,
      `/api/v1/admin/security/deletion-trash/${fixtures.expiredShop.id}/restore`,
      "POST",
      { totpCode: "000000" },
    );
    record(
      viewerRestoreStatus === 403,
      "Viewer cannot invoke a restore endpoint from the browser session",
    );

    advanceClock(60_001);
    await waitForAdminLoginThrottleWindow();
    const salesPage = await salesContext.newPage();
    const salesToken = await loginAdmin(
      salesPage,
      fixtures.accounts.salesAdmin,
    );
    await absent(
      salesPage.getByRole("link", { name: /Security & audit/ }),
      "Sales Admin has no Super Admin security navigation",
    );
    await salesPage.goto("/dashboard/admin/security");
    await visible(
      salesPage.getByRole("heading", { name: "Super Admin only" }),
      "Sales Admin direct navigation is denied by the protected security page",
    );
    const salesQueueStatus = await protectedRequestStatus(
      salesPage,
      salesToken,
      "/api/v1/admin/security/deletion-requests",
      "GET",
    );
    record(
      salesQueueStatus === 403,
      "Sales Admin browser session is rejected by the protected approval API",
    );
    const salesRestoreStatus = await protectedRequestStatus(
      salesPage,
      salesToken,
      `/api/v1/admin/security/deletion-trash/${fixtures.expiredShop.id}/restore`,
      "POST",
      { totpCode: "000000" },
    );
    record(
      salesRestoreStatus === 403,
      "Sales Admin cannot invoke restoration from an authenticated browser request",
    );

    const ownerPage = await ownerContext.newPage();
    const ownerToken = await loginOwner(ownerPage, fixtures.accounts.shopOwner);
    await ownerPage.goto("/dashboard/admin/security");
    await exactURL(
      ownerPage,
      /\/admin\/login$/,
      "Shop-owner session cannot enter the internal-admin route boundary",
    );
    await absent(
      ownerPage.getByRole("heading", {
        name: "Security & Audit Control Center",
      }),
      "Shop owner cannot view recovery records",
    );
    const ownerRestoreStatus = await protectedRequestStatus(
      ownerPage,
      ownerToken,
      `/api/v1/admin/security/deletion-trash/${fixtures.expiredShop.id}/restore`,
      "POST",
      { totpCode: "000000" },
    );
    record(
      ownerRestoreStatus === 403,
      "Shop-owner STAFF-audience session cannot restore through the backend API",
    );

    const anonymousPage = await routeWithAuth(
      anonymousContext,
      "/dashboard/admin/security",
    );
    await exactURL(
      anonymousPage,
      /\/admin\/login$/,
      "Unauthenticated direct security URL returns to admin sign-in",
    );
    await absent(
      anonymousPage.getByRole("heading", {
        name: "Security & Audit Control Center",
      }),
      "Unauthenticated browser receives no protected recovery data",
    );

    await coPage.goto("/dashboard/admin");
    await coPage.getByRole("button", { name: "Log out" }).click();
    await coPage.reload();
    await exactURL(
      coPage,
      /\/admin\/login$/,
      "Logout ends the admin workspace browser session after refresh",
    );
    const postLogoutCookies = await coContext.cookies(baseURL);
    record(
      !postLogoutCookies.some((cookie) => cookie.httpOnly),
      "Logout clears the HttpOnly refresh cookie",
    );

    const resultPath = process.env.PR168_BROWSER_RESULT_FILE;
    if (!resultPath)
      throw new Error("PR #168 browser result path is required.");
    writeFileSync(
      resultPath,
      JSON.stringify(
        { version: 1, requestId, shopId: fixtures.shop.id, assertionCount },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Chromium browser recovery certification: **${assertionCount} browser assertions passed** across real Co-Founder, Super Admin, Viewer, shop-owner and anonymous sessions. Request → approval → quarantine → restore used the production web/backend code against disposable PostgreSQL only.\n`,
      );
    }
    console.log(
      `PASS: ${assertionCount} real Chromium assertions across UI, session, authorization, quarantine and restoration scenarios.`,
    );
  } finally {
    await Promise.all([
      coContext.close(),
      adminContext.close(),
      viewerContext.close(),
      salesContext.close(),
      ownerContext.close(),
      anonymousContext.close(),
    ]);
  }
});
