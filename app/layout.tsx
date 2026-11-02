import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Full Stack HQ",
  description: "Full Stack Services and Peter Quinn operating workspaces",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 antialiased">{children}</body>
    </html>
  );
}
