"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@barbercue/shared";
import { useAuth } from "../../../../lib/auth-context";
import { AuthCard, AuthPageFallback } from "../../../../components/auth/AuthCard";
import { EmployeeLoginForm } from "../../../../components/auth/EmployeeLoginForm";

function EmployeeLoginPageInner() {
  const { employeeLogin, user, status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && user?.roles.includes(Role.FIELD_EXECUTIVE)) {
      router.replace("/employee");
    }
  }, [router, status, user]);

  if (status === "loading" || (status === "authenticated" && user?.roles.includes(Role.FIELD_EXECUTIVE))) {
    return <AuthPageFallback audience="employee" />;
  }

  return (
    <AuthCard
      audience="employee"
      title="Employee sign in"
      subtitle="Use the FastQue Employee ID and password issued by your administrator."
    >
      <EmployeeLoginForm
        onSubmit={async (input) => {
          const loggedIn = await employeeLogin(input);
          if (!loggedIn.roles.includes(Role.FIELD_EXECUTIVE)) {
            throw new Error("This account is not a FastQue field employee.");
          }
          router.replace("/employee");
        }}
      />
    </AuthCard>
  );
}

export default function EmployeeLoginPage() {
  return (
    <Suspense fallback={<AuthPageFallback audience="employee" />}>
      <EmployeeLoginPageInner />
    </Suspense>
  );
}
