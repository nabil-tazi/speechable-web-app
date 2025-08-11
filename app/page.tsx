import Link from "next/link";
import { getCurrentUserProfile } from "@/app/features/users/models";
import { createClient } from "@/app/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userProfile = user ? await getCurrentUserProfile() : null;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-6xl font-bold">Welcome to Audiify</h1>

        {user ? (
          <div>
            <p className="mt-3 text-2xl">
              Welcome, {userProfile?.display_name || user.email}
            </p>
            {!userProfile?.display_name && (
              <p className="mt-2 text-sm text-gray-600">
                <Link
                  href="/profile"
                  className="text-blue-500 hover:text-blue-700"
                >
                  Set up your display name
                </Link>
              </p>
            )}
            <div className="mt-4 space-x-4">
              <Link
                href="/profile"
                className="inline-block bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Edit Profile
              </Link>
              <form action="/auth/signout" method="post" className="inline">
                <button
                  className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div>
            <p className="mt-3 text-2xl">You are not logged in.</p>
            <div className="mt-4 space-x-4">
              <Link
                href="/signin"
                className="inline-block bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-block bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
              >
                Sign Up
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
