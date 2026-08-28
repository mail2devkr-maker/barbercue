"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import { EmailPasswordLoginForm } from "../../../../components/auth/EmailPasswordLoginForm";
import { safeNextPath } from "../../../../lib/safe-next-path";

function StaffLoginForm() {
  const { staffLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthCard
      audience="staff"
      title="Barber & staff sign in"
      subtitle="Use the email and password from your shop invitation. You’ll return to your shop workspace after sign-in."
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

export default function StaffLoginPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="staff" />}>
      <StaffLoginForm />
    </Suspense>
  );
}
