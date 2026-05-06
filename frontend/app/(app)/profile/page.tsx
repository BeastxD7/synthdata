"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { userApi } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { PageShell } from "@/components/app/page-shell";

export default function ProfilePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const clearAuth = useAuthStore((s) => s.clearAuth);

  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [passwordMsg, setPasswordMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  async function saveName() {
    if (!name.trim() || name === user?.name) return;
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await userApi.update(name.trim(), undefined);
    if (res.success && res.data) {
      updateUser({ ...user!, name: res.data.name });
      setProfileMsg({ kind: "ok", text: "Profile updated." });
    } else {
      setProfileMsg({ kind: "err", text: res.message || "Update failed." });
    }
    setSavingProfile(false);
  }

  async function savePassword() {
    if (password.length < 8) {
      setPasswordMsg({ kind: "err", text: "Password must be at least 8 characters." });
      return;
    }
    setSavingPassword(true);
    setPasswordMsg(null);
    const res = await userApi.update(undefined, password);
    if (res.success) {
      setPassword("");
      setPasswordMsg({ kind: "ok", text: "Password updated." });
    } else {
      setPasswordMsg({ kind: "err", text: res.message || "Update failed." });
    }
    setSavingPassword(false);
  }

  async function deactivate() {
    setDeactivating(true);
    await userApi.deactivate();
    clearAuth();
    router.replace("/login");
  }

  return (
    <PageShell className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Account settings and security.</p>
      </header>

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">Account</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Detail label="Email" value={user?.email ?? "—"} mono />
          <Detail label="Role" value={user?.role ?? "—"} />
          <Detail label="Joined" value={user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—"} />
          <Detail label="Credits" value={(user?.credits ?? 0).toLocaleString()} />
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">Display name</h2>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {profileMsg && (
          <Alert variant={profileMsg.kind === "err" ? "destructive" : "default"} className="py-2">
            <AlertDescription className="text-xs">{profileMsg.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button onClick={saveName} disabled={savingProfile || !name.trim() || name === user?.name}>
            {savingProfile && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <h2 className="text-sm font-semibold">Change password</h2>
        <div className="space-y-2">
          <Label htmlFor="pw">New password</Label>
          <Input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        {passwordMsg && (
          <Alert variant={passwordMsg.kind === "err" ? "destructive" : "default"} className="py-2">
            <AlertDescription className="text-xs">{passwordMsg.text}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button onClick={savePassword} disabled={savingPassword || password.length < 8}>
            {savingPassword && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3 border-destructive/30">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <p className="text-xs text-muted-foreground">
          Deactivating logs you out and disables future sign-ins. Your jobs and data are kept.
        </p>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5">
              Deactivate account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Deactivate your account?</DialogTitle>
              <DialogDescription>
                You&apos;ll be logged out immediately. Sign-in attempts will fail until an admin reactivates you.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button onClick={deactivate} disabled={deactivating} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deactivating ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
                Deactivate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    </PageShell>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-medium ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
