"use client";

import { LoginForm } from "@/components/login-form";
import { AuthLayout } from "@/components/ui/auth-wrapper";

export default function LoginPage() {
  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
