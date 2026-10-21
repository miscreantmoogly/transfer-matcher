import type { Metadata } from "next";
// Inter, self-hosted from npm so the demo never depends on reaching Google Fonts.
import "@fontsource-variable/inter";
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
