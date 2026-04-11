"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { onAuthChange, signOut } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tenders", icon: "\uD83D\uDCC4" },
  { href: "/companies", label: "Companies", icon: "\uD83C\uDFE2" },
  { href: "/contacts", label: "Contacts", icon: "\uD83D\uDC65" },
  { href: "/alerts", label: "Alerts", icon: "\u26A1" },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    return onAuthChange(setUser);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <aside className="fixed top-0 left-0 h-screen w-56 bg-[#0D1F3C] text-white flex flex-col z-50">
      {/* Logo */}
      <div
        className="px-5 py-4 cursor-pointer border-b border-white/10"
        onClick={() => router.push("/dashboard")}
      >
        <img src="/logo-white.png" alt="Ingro Energy" className="h-8 mb-1" />
        <div className="text-xs text-gray-400">BESS Tender Dashboard</div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              pathname?.startsWith(item.href.replace(/s$/, "/")));
          return (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                isActive
                  ? "bg-white/15 font-medium text-white"
                  : "text-gray-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* User section */}
      {user && (
        <div className="border-t border-white/10 px-4 py-4">
          <div className="text-xs text-gray-400 truncate mb-2">
            {user.email}
          </div>
          <button
            onClick={handleSignOut}
            className="w-full text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
