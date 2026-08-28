import { AuthCard } from "./AuthCard";

export function CustomerAuthCard({ children }: { children: React.ReactNode }) {
  return (
    <AuthCard
      audience="customer"
      title="Customer sign in"
      subtitle="Continue to your bookings, live queue visits, Premium plan and AI Style Advisor."
    >
      {children}
    </AuthCard>
  );
}
