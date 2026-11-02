import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "./_components/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { THEME_BOOT } from "./_components/theme-toggle";

// Be Vietnam Pro: designed in Vietnam, clean diacritics at small sizes.
const beVietnam = Be_Vietnam_Pro({
  variable: "--font-bvp",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const jbMono = JetBrains_Mono({
  variable: "--font-jb-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Social Manager",
  description: "Quản lý tài khoản mạng xã hội nội bộ",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Layout decides whether to render the app shell (with sidebar) or a
  // bare auth shell (login/register pages). When there is no valid session
  // we always fall back to the bare shell — middleware redirects unauth
  // users to /login, so the bare shell is what they will see.
  const user = await getCurrentUser();

  return (
    // data-theme is set by THEME_BOOT before hydration.
    <html lang="vi" className={`${beVietnam.variable} ${jbMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {user ? (
          <AppShell user={{ username: user.username, role: user.role }}>
            {children}
          </AppShell>
        ) : (
          <main className="auth-shell">{children}</main>
        )}
      </body>
    </html>
  );
}
