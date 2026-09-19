"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import { EmailPasswordLoginForm } from "../../../../components/auth/EmailPasswordLoginForm";
import { WorkspaceGoogleLogin } from "../../../../components/auth/WorkspaceGoogleLogin";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { isWorkspaceUser, workspaceLandingPath } from "../../../../lib/workspace-route";

function OwnerLoginForm() {
  const { staffLogin, user, status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // A valid owner/staff/admin session must survive a trip to the public Home page. Some Home
  // surfaces (notably the footer's legacy "Owner login" link) still point at this route directly.
  // Do not ask an already-authenticated workspace user to sign in again: send them straight back
  // to their role-scoped dashboard. Customer-audience sessions are intentionally NOT redirected,
  // because the same person may need to switch from a CUSTOMER session into their owner account.
  useEffect(() => {
    if (status === "authenticated" && user && isWorkspaceUser(user)) {
      router.replace(
        safeNextPath(searchParams.get("next")) ?? workspaceLandingPath(user),
      );
    }
  }, [router, searchParams, status, user]);

  if (status === "loading" || (status === "authenticated" && user && isWorkspaceUser(user))) {
    return <AuthPageFallback audience="owner" />;
  }

  return (
    <AuthCard
      audience="owner"
      title="Shop owner sign in"
      subtitle="Use the owner account connected to your FastQue shop. You’ll return to your shop dashboard after sign-in."
    >
      <WorkspaceGoogleLogin
        audienceLabel="shop owner"
        onSuccess={(user) => router.replace(
          safeNextPath(searchParams.get("next")) ?? workspaceLandingPath(user),
        )}
      />
      <EmailPasswordLoginForm
        forgotPasswordHref="/forgot-password?audience=owner"
        onSubmit={async (input) => {
          const user = await staffLogin(input);
          router.replace(safeNextPath(searchParams.get("next")) ?? workspaceLandingPath(user));
        }}
      />
    </AuthCard>
  );
}

export default function OwnerLoginPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="owner" />}>
      <OwnerLoginForm />
    </Suspense>
  );
}
