"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import { EmailPasswordLoginForm } from "../../../../components/auth/EmailPasswordLoginForm";
import { WorkspaceGoogleLogin } from "../../../../components/auth/WorkspaceGoogleLogin";
import { safeNextPath } from "../../../../lib/safe-next-path";
import { workspaceLandingPath } from "../../../../lib/workspace-route";

function OwnerLoginForm() {
  const { staffLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthCard
      audience="owner"
      title="Shop owner sign in"
      subtitle="Use the owner account connected to your BarberCue shop. You’ll return to your shop dashboard after sign-in."
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
