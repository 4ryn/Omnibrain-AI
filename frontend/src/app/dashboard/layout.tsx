"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Loading, cn } from "@/components/ui";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "🏠" },
  { href: "/dashboard/knowledge", label: "Knowledge", icon: "🧠" },
  { href: "/dashboard/documents", label: "Documents", icon: "📄" },
  { href: "/dashboard/urls", label: "URLs", icon: "🔗" },
  { href: "/dashboard/playground", label: "Playground", icon: "🧪" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "💬" },
  { href: "/dashboard/unanswered", label: "Unanswered", icon: "❓" },
  { href: "/dashboard/leads", label: "Leads", icon: "📇" },
  { href: "/dashboard/widget", label: "Widget", icon: "🧩" },
  { href: "/dashboard/ai-config", label: "AI Configuration", icon: "⚙️" },
  { href: "/dashboard/usage", label: "Usage", icon: "📊" },
  { href: "/dashboard/settings", label: "Settings", icon: "🛠️" },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/auth/me"), retry: false });

  if (me.isError) {
    if (typeof window !== "undefined" && me.error instanceof ApiError && me.error.status === 401) window.location.href = "/login";
    return <div className="p-10 text-center text-sm text-slate-600">{me.error instanceof ApiError && me.error.status === 401 ? "Redirecting to sign-in…" : (me.error as Error).message}</div>;
  }
  if (!me.data) return <Loading />;
  const { user, workspaces } = me.data;
  const ws = workspaces[0];

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <span className="font-semibold">🧠 OmniBrain</span>
        <button aria-label="Toggle navigation" aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)} className="rounded-md border border-slate-300 px-2 py-1 text-sm">Menu</button>
      </header>
      <aside className={cn("w-full shrink-0 border-r border-slate-200 bg-white md:block md:w-60", navOpen ? "block" : "hidden")}>
        <div className="hidden px-5 py-5 md:block"><div className="text-lg font-semibold">🧠 OmniBrain</div><div className="mt-0.5 truncate text-xs text-slate-500">{ws?.name}</div></div>
        <nav aria-label="Main" className="px-3 pb-4">
          {NAV.map((n) => {
            const active = n.href === "/dashboard" ? pathname === n.href : pathname.startsWith(n.href);
            return <Link key={n.href} href={n.href} onClick={() => setNavOpen(false)} aria-current={active ? "page" : undefined}
              className={cn("mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm", active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
              <span aria-hidden>{n.icon}</span>{n.label}</Link>;
          })}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex items-center gap-2">
            {user.avatar_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs">{(user.name || user.email)[0].toUpperCase()}</span>}
            <div className="min-w-0"><div className="truncate font-medium">{user.name || user.email}</div><div className="truncate text-xs text-slate-500">{user.email}</div></div>
          </div>
          <button onClick={logout} className="mt-3 text-xs font-medium text-slate-500 hover:text-slate-800">Sign out</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8"><div className="mx-auto max-w-6xl">{me.data.role === "member" && <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">You have read-only access to this workspace. Ask an owner or admin to make changes.</div>}{children}</div></main>
    </div>
  );
}