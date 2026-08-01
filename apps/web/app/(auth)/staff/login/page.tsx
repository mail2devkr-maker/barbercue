"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard } from "../../../../components/auth/AuthCard";
import { EmailPasswordLoginForm } from "../../../../components/auth/EmailPasswordLoginForm";

function StaffLoginForm() {
  const { staffLogin } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthCard title="Staff login">
      <EmailPasswordLoginForm
        forgotPasswordHref="/forgot-password"
        onSubmit={async (input) => {
          await staffLogin(input);
          router.replace(searchParams.get("next") ?? "/dashboard/salons");
        }}
      />
    </AuthCard>
  );
}

export default function StaffLoginPage() {
  return (
    <Suspense fallback={null}>
      <StaffLoginForm />
    </Suspense>
  );
}
