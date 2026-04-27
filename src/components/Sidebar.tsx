"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { onAuthChange, signOut } from "@/lib/auth";
import { useRouter, usePathname } from "next/navigation";
import ReminderBell from "./ReminderBell";

// SVG icon components — clean, consistent Heroicons-style
function IconTenders({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconAuthorities({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
    </svg>
  );
}

function IconCompanies({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
    </svg>
  );
}

function IconContacts({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  );
}

function IconActivity({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
  );
}

function IconEmployees({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function IconAlerts({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function IconArchives({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

const NAV_ITEMS = [
  { href: "/home", label: "Home", Icon: IconHome },
  { href: "/dashboard", label: "Tenders", Icon: IconTenders },
  { href: "/authorities", label: "Authorities", Icon: IconAuthorities },
  { href: "/companies", label: "Companies", Icon: IconCompanies },
  { href: "/contacts", label: "Contacts", Icon: IconContacts },
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/activity", label: "Activity", Icon: IconActivity },
  { href: "/employees", label: "Employees", Icon: IconEmployees },
  { href: "/alerts", label: "Alerts", Icon: IconAlerts },
  { href: "/archives", label: "Archives", Icon: IconArchives },
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
        {/* Logo + reminder bell + collapse toggle */}
        <div className={`border-b border-white/10 px-3 py-4 ${collapsed ? "flex flex-col items-center gap-2" : "flex items-center justify-between gap-2"}`}>
          {!collapsed && (
            <div className="cursor-pointer overflow-hidden flex-1 min-w-0" onClick={() => router.push("/home")}>
              <img src="/logo-white.png" alt="Ingro Energy" className="h-7" />
            </div>
          )}
          <div className={`flex items-center gap-1 shrink-0 ${collapsed ? "flex-col" : ""}`}>
            <ReminderBell collapsed={collapsed} />
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-gray-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className={`w-4 h-4 transition-transform ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 px-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname?.startsWith(item.href.replace(/s$/, "/")));
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
                <item.Icon className="w-5 h-5 shrink-0" />
                {!collapsed && item.label}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        {user && (
          <div className="border-t border-white/10 px-3 py-4">
            {!collapsed && (
              <div className="text-xs text-gray-400 truncate mb-2">{user.email}</div>
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

      <style>{`.sidebar-content { margin-left: ${collapsed ? "4rem" : "14rem"}; transition: margin-left 0.2s; }`}</style>
    </>
  );
}
