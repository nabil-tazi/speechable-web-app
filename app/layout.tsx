import type { Metadata } from "next";
import "./globals.css";
import { UserProvider } from "./features/users/context";
import { AppSettingsProvider } from "./features/app-settings/context";

export const metadata: Metadata = {
  title: "Readible",
  description: "Transform documents into natural audio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased"
        suppressHydrationWarning={true}
      >
        <UserProvider>
          <AppSettingsProvider>
            {children}
          </AppSettingsProvider>
        </UserProvider>
      </body>
    </html>
  );
}
