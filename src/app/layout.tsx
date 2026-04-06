import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BESS Tender Dashboard — Ingro Energy",
  description:
    "Track Battery Energy Storage System tenders across Indian government portals",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 min-h-screen">{children}</body>
    </html>
  );
}
