"use client";

import { SignupForm } from "@/components/signup-form";
import { AuthLayout } from "@/components/ui/auth-wrapper";

export default function LoginPage() {
  return (
    <AuthLayout>
      <SignupForm />
    </AuthLayout>
  );
}
