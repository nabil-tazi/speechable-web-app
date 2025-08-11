import Link from "next/link";

export default function AuthCodeError() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold text-red-600 mb-4">
          Authentication Error
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Sorry, we couldn't log you in.
        </p>
        <p className="text-lg text-gray-500 mb-8">
          There was an issue with the authentication code. Please try signing in
          again.
        </p>
        <div className="space-x-4">
          <Link
            href="/login"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Try Again
          </Link>
          <Link
            href="/"
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Go Home
          </Link>
        </div>
      </main>
    </div>
  );
}
