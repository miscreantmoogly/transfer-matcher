import type { Metadata } from "next";
// Public Sans: a plain-spoken, sturdy sans (originally made for US government
// sites), readable for people who don't live in software all day. Self-hosted
// from npm so the demo never depends on reaching Google Fonts.
import "@fontsource-variable/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Transfer Matcher",
  description: "Find money you moved between your own accounts and businesses, and keep it off your P&L.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
