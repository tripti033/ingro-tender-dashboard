"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { onAuthChange, signOut } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tenders" },
  { href: "/authorities", label: "Authorities" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
  { href: "/alerts", label: "Alerts" },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    return onAuthChange(setUser);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <>
      <aside
        className={`fixed top-0 left-0 h-screen bg-[#0D1F3C] text-white flex flex-col z-50 transition-all duration-200 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        {/* Logo + collapse toggle */}
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-4">
          {!collapsed && (
            <div
              className="cursor-pointer overflow-hidden"
              onClick={() => router.push("/dashboard")}
            >
              <img src="/logo-white.png" alt="Ingro Energy" className="h-7" />
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg
              className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" &&
                pathname?.startsWith(item.href.replace(/s$/, "/")));
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center ${collapsed ? "justify-center" : ""} gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                  isActive
                    ? "bg-white/15 font-medium text-white"
                    : "text-gray-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">
                  {item.label[0]}
                </span>
                {!collapsed && item.label}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        {user && (
          <div className="border-t border-white/10 px-3 py-4">
            {!collapsed && (
              <div className="text-xs text-gray-400 truncate mb-2">
                {user.email}
              </div>
            )}
            <button
              onClick={handleSignOut}
              title={collapsed ? "Sign out" : undefined}
              className={`${collapsed ? "w-full flex justify-center" : "w-full"} text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-2 rounded-lg transition-colors`}
            >
              {collapsed ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              ) : (
                "Sign out"
              )}
            </button>
          </div>
        )}
      </aside>

      {/* Global style to set content margin based on sidebar state */}
      <style>{`.sidebar-content { margin-left: ${collapsed ? "4rem" : "14rem"}; transition: margin-left 0.2s; }`}</style>
    </>
  );
}
