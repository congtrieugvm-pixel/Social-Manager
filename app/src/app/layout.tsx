import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { AppShell } from "./_components/app-shell";
import { getCurrentUser } from "@/lib/auth";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "400", "500", "600", "700"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
    <html
      lang="vi"
      className={`${fraunces.variable} ${manrope.variable} ${jbMono.variable}`}
      style={{
        // @ts-expect-error — CSS custom property overrides for font families
        "--font-serif": `var(--font-fraunces), ui-serif, Georgia, serif`,
        "--font-sans": `var(--font-manrope), ui-sans-serif, system-ui, sans-serif`,
        "--font-mono": `var(--font-jb-mono), ui-monospace, Menlo, monospace`,
      }}
    >
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
