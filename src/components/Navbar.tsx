"use client";

import { useEffect, useState } from "react";
import { type User } from "firebase/auth";
import { onAuthChange, signOut } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    return onAuthChange(setUser);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <nav className="sticky top-0 z-50 bg-[#0D1F3C] text-white px-6 py-3 flex items-center justify-between shadow-md">
      <h1
        className="text-lg font-bold cursor-pointer"
        onClick={() => router.push("/dashboard")}
      >
        BESS Tender Dashboard
      </h1>
      {user && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300">{user.email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
