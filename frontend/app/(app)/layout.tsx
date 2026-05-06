import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { AuthGuard } from "@/components/app/auth-guard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen bg-background">
        <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar sticky top-0 h-screen">
          <Sidebar />
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar />
          <main className="flex-1 overflow-x-hidden">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
