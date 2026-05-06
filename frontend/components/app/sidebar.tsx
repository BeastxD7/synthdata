"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  Plus,
  Coins,
  Settings,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  highlight?: boolean;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard",  icon: LayoutDashboard },
  { href: "/jobs",      label: "Jobs",       icon: Boxes },
  { href: "/jobs/new",  label: "New job",    icon: Plus, highlight: true },
  { href: "/credits",   label: "Credits",    icon: Coins },
  { href: "/profile",   label: "Profile",    icon: Settings },
  { href: "/admin",     label: "Admin",      icon: Sliders, adminOnly: true },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const role = useAuthStore((s) => s.user?.role);

  const items = NAV.filter((n) => !n.adminOnly || role === "admin");

  // Longest-matching href wins — prevents both "/jobs" and "/jobs/new" lighting up.
  let bestMatch: string | null = null;
  let bestLen = -1;
  for (const item of items) {
    const matches = pathname === item.href || pathname.startsWith(item.href + "/");
    if (matches && item.href.length > bestLen) {
      bestMatch = item.href;
      bestLen = item.href.length;
    }
  }

  return (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 py-3">
        <Link href="/dashboard" className="flex items-center gap-2" onClick={onNavigate}>
          <div className="size-7 rounded-md bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-sm font-bold tracking-tight">S</span>
          </div>
          <span className="font-semibold tracking-tight">SynthData</span>
        </Link>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {items.map((item) => {
          const active = bestMatch === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                item.highlight && !active && "text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto px-2 pt-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">v0.1</p>
      </div>
    </nav>
  );
}
