"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import { EmailPasswordLoginForm } from "../../../../components/auth/EmailPasswordLoginForm";
import { safeNextPath } from "../../../../lib/safe-next-path";

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
      <EmailPasswordLoginForm
        forgotPasswordHref="/forgot-password"
        onSubmit={async (input) => {
          await staffLogin(input);
          router.replace(safeNextPath(searchParams.get("next")) ?? "/dashboard/salons");
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
