"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { supabase } from "@/app/lib/supabase";
import { APP_VERSION } from "@/lib/version";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  const validateForm = () => {
    if (!email || !password) {
      setError("Email and password are required");
      return false;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long");
      return false;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return false;
    }

    return true;
  };

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("User already registered")) {
          setError(
            "An account with this email already exists. Try signing in instead."
          );
        } else {
          setError(signUpError.message);
        }
        return;
      }

      if (data.user) {
        if (data.user.identities && data.user.identities.length === 0) {
          setError(
            "An account with this email already exists. Try signing in instead."
          );
        } else {
          // Trigger exit animation, then show success screen
          setIsExiting(true);
          setTimeout(() => {
            setEmailSent(true);
          }, 500);
        }
      }
    } catch (err) {
      console.error("Sign up error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError(null);
    setIsLoading(true);
    setIsExiting(true);

    // Small delay to show exit animation before OAuth redirect
    await new Promise(resolve => setTimeout(resolve, 400));

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setError(error.message);
        setIsLoading(false);
        setIsExiting(false);
      }
    } catch (err) {
      console.error("Google sign up error:", err);
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
      setIsExiting(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen flex">
        {/* Left side - Illustration */}
        <div className="hidden lg:flex lg:w-1/2 bg-brand-primary-dark items-center justify-center p-12">
          <div className="text-center">
            <div className="flex items-center gap-3 justify-center mb-8">
              <Image src="/logo-white.svg" alt="Speechable" width={48} height={48} />
              <span className="text-2xl font-semibold text-white">Speechable</span>
            </div>
            <div className="w-[280px] h-[280px] mx-auto mb-8">
              <Image
                src="/doodles/LovingDoodle.svg"
                alt=""
                width={280}
                height={280}
                className="w-full h-full object-contain brightness-0 invert opacity-90"
                priority
              />
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">Almost there!</h2>
            <p className="text-white/80 text-lg">Just one more step</p>
          </div>
        </div>

        {/* Right side - Message */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50">
          <div className="max-w-md w-full space-y-8">
            <div className="text-center lg:text-left">
              <div className="mx-auto lg:mx-0 h-12 w-12 flex items-center justify-center rounded-full bg-green-100 mb-4">
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                Check your email
              </h2>
              <p className="mt-2 text-gray-600">
                We've sent a confirmation link to
              </p>
              <p className="font-medium text-gray-900">{email}</p>
              <p className="mt-4 text-sm text-gray-500">
                Click the link in your email to complete your account setup.
              </p>
            </div>

            <div className="space-y-2 text-center lg:text-left">
              <p className="text-sm text-gray-500">
                Didn't receive the email? Check your spam folder.
              </p>
              <Link
                href="/signin"
                className="inline-block font-medium text-brand-primary-dark hover:text-brand-primary-dark/80 transition-colors text-sm"
              >
                ← Back to Sign in
              </Link>
            </div>

            <p className="text-xs text-gray-400 text-center lg:text-left">v{APP_VERSION}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side - Illustration */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand-primary-dark items-center justify-center p-12 overflow-hidden">
        <div className="text-center">
          {/* Logo - fades in first */}
          <motion.div
            className="flex items-center gap-3 justify-center mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Image src="/logo-white.svg" alt="Speechable" width={48} height={48} />
            <span className="text-2xl font-semibold text-white">Speechable</span>
          </motion.div>

          {/* Doodle - slides in from left after logo */}
          <motion.div
            className="w-[280px] h-[280px] mx-auto mb-8"
            initial={{ x: -400, opacity: 0 }}
            animate={{
              x: isExiting ? 400 : 0,
              opacity: isExiting ? 0 : 1
            }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 20,
              delay: isExiting ? 0 : 0.5
            }}
          >
            <Image
              src="/doodles/RollerSkatingDoodle.svg"
              alt=""
              width={280}
              height={280}
              className="w-full h-full object-contain brightness-0 invert opacity-90"
              priority
            />
          </motion.div>

          {/* Tagline - fades in last */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.0 }}
          >
            <h2 className="text-3xl font-bold text-white mb-4">Join the party!</h2>
            <p className="text-white/80 text-lg">Turn any text into audio</p>
          </motion.div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center lg:text-left">
            <h2 className="text-2xl font-bold text-gray-900">
              Create your account
            </h2>
            <p className="mt-2 text-gray-600">
              Start listening in minutes
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSignUp}>
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-4">
                <div className="text-sm text-red-800">{error}</div>
                {error.includes("already exists") && (
                  <Link
                    href="/signin"
                    className="mt-2 text-sm font-medium text-red-600 hover:text-red-500 underline block"
                  >
                    Go to Sign in →
                  </Link>
                )}
              </div>
            )}

            {/* Google Sign up Button */}
            <button
              type="button"
              onClick={handleGoogleSignUp}
              disabled={isLoading}
              className="w-full flex justify-center items-center py-2.5 px-4 border border-gray-300 rounded-lg bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {isLoading ? "Processing..." : "Continue with Google"}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with email
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary-dark focus:border-brand-primary-dark disabled:opacity-50"
                  placeholder="Enter your email"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary-dark focus:border-brand-primary-dark disabled:opacity-50"
                  placeholder="Create a password"
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary-dark focus:border-brand-primary-dark disabled:opacity-50"
                  placeholder="Confirm your password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-brand-primary-dark hover:bg-brand-primary-dark/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating account...
                </div>
              ) : (
                "Let's go!"
              )}
            </button>

            <div className="text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{" "}
                <Link
                  href="/signin"
                  className="font-medium text-brand-primary-dark hover:text-brand-primary-dark/80 transition-colors"
                >
                  Sign in here
                </Link>
              </p>
            </div>
          </form>

          <div className="text-center lg:text-left">
            <p className="text-xs text-gray-400">
              By signing up, you agree to our{" "}
              <a href="#" className="underline hover:text-gray-600">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="underline hover:text-gray-600">
                Privacy Policy
              </a>
            </p>
          </div>

          <p className="text-xs text-gray-400 text-center lg:text-left">v{APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}
