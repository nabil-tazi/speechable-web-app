import { AuthLayout } from "@/components/ui/auth-wrapper";
import { PasswordGateForm } from "@/components/password-gate-form";
import { Suspense } from "react";

export default function GatePage() {
  return (
    <AuthLayout>
      <Suspense fallback={<div>Loading...</div>}>
        <PasswordGateForm />
      </Suspense>
    </AuthLayout>
  );
}
