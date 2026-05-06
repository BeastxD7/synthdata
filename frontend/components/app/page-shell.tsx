import { cn } from "@/lib/utils";

/**
 * Shared page container. Every app route uses this so widths and gutters
 * stay consistent across /dashboard, /jobs, /jobs/new, /credits, etc.
 *
 * Outer width is fixed at max-w-6xl (1152px). Pages with narrow content
 * (forms, profile) constrain their inner card with max-w-* — the gutters
 * stay the same so the layout doesn't shift between routes.
 */
export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 py-6 sm:py-10", className)}>
      {children}
    </div>
  );
}
