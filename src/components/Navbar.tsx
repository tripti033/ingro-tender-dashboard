"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { onAuthChange, signOut } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/dashboard", label: "Tenders" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
];

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => { return onAuthChange(setUser); }, []);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <nav className="sticky top-0 z-50 bg-[#0D1F3C] text-white px-6 py-3 flex items-center justify-between shadow-md">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-bold cursor-pointer" onClick={() => router.push("/dashboard")}>
          BESS Tender Dashboard
        </h1>
        <div className="flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href.replace(/s$/, "/"));
            return (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  isActive ? "bg-[#1a1d24]/20 font-medium" : "text-gray-300 hover:bg-[#1a1d24]/10"
                }`}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      </div>
      {user && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300">{user.email}</span>
          <button onClick={handleSignOut} className="text-sm bg-[#1a1d24]/10 hover:bg-[#1a1d24]/20 px-3 py-1.5 rounded transition-colors">
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
