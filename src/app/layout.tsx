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
      <body className="bg-[#1a1d24] text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
