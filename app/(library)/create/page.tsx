import Link from "next/link";
import { getCurrentUserProfile } from "@/app/features/users/models";
import { createClient } from "@/app/lib/supabase/server";
import PDFUploader from "@/app/features/pdf/components/pdf-uploader";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  console.log(user);

  const userProfile = user ? await getCurrentUserProfile() : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Main Content */}
      <main className="flex flex-col items-center justify-center flex-1 px-4 sm:px-20 text-center pt-20">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-6xl font-bold text-gray-900 mb-8">
            Welcome to Speechable
          </h1>

          {user ? (
            <div className="space-y-6">
              <p className="text-xl sm:text-2xl text-gray-700">
                Welcome back, {userProfile?.display_name || user.email}
              </p>

              <PDFUploader userId={user.id} />

              {!userProfile?.display_name && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-md mx-auto">
                  <p className="text-sm text-blue-800 mb-2">
                    Complete your profile setup
                  </p>
                  <Link
                    href="/profile"
                    className="text-blue-600 hover:text-blue-700 font-medium text-sm transition-colors"
                  >
                    Set up your display name →
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              <p className="text-xl sm:text-2xl text-gray-700">
                Get started with your audio experience
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/login"
                  className="inline-flex justify-center items-center px-6 py-3 border border-gray-300 rounded-md shadow-sm bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex justify-center items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  Get started
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
