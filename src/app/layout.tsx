import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BESS Tender Dashboard — Ingro Energy",
  description:
    "Track Battery Energy Storage System tenders across Indian government portals",
};

const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored || 'light';
    if (theme === 'light') document.documentElement.classList.add('light');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="bg-[var(--bg-body)] text-[var(--text-primary)] min-h-screen">
        {children}
      </body>
    </html>
  );
}
