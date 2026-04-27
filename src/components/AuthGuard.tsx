"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type User } from "firebase/auth";
import { onAuthChange } from "@/lib/auth";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      if (!u) {
        router.replace("/login");
      } else {
        setUser(u);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-gray-800 border-t-[#0D1F3C]" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
