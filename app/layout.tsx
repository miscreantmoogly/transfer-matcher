import type { Metadata } from "next";
// Inter, self-hosted from npm so the demo never depends on reaching Google Fonts.
import "@fontsource-variable/inter";
import "./globals.css";
import { themeCss } from "@/design-system/colors";

export const metadata: Metadata = {
  title: "Transfer Matcher",
  description: "Find money you moved between your own accounts and businesses, and keep it off your P&L.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Color tokens come from design-system/colors.ts, the single source for every component. */}
        <style id="am-theme">{themeCss()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
