"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { setAccessToken, setRefreshToken } from "@/lib/api";

/**
 * Hydrates token state from the persisted store into the api module's
 * mutable token holders, then either renders children (authed) or
 * redirects to /login.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, accessToken, refreshToken, _hasHydrated } = useAuthStore();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!_hasHydrated) return;
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);
    setSynced(true);
    if (!isAuthenticated || !accessToken) {
      router.replace("/login");
    }
  }, [_hasHydrated, isAuthenticated, accessToken, refreshToken, router]);

  if (!_hasHydrated || !synced || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 rounded-full border-2 border-muted border-t-primary animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
