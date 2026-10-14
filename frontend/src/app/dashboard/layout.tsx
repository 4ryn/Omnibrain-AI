
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { Loading, cn } from "@/components/ui";
import logo from "@/logo.png";

import {
  House,
  LayoutDashboard,
  BrainCircuit,
  FileText,
  Globe,
  FlaskConical,
  MessagesSquare,
  CircleHelp,
  ContactRound,
  Blocks,
  Settings2,
  ChartNoAxesCombined,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  Sparkles,
  ChevronRight,
} from "lucide-react";

const NAV = [
  {
    section: "WORKSPACE",
    items: [
      { href: "/", label: "Home", icon: House },
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/knowledge", label: "Knowledge", icon: BrainCircuit },
      { href: "/dashboard/documents", label: "Documents", icon: FileText },
      { href: "/dashboard/urls", label: "Website URLs", icon: Globe },
      { href: "/dashboard/playground", label: "Playground", icon: FlaskConical },
      {
        href: "/dashboard/conversations",
        label: "Conversations",
        icon: MessagesSquare,
      },
      {
        href: "/dashboard/unanswered",
        label: "Unanswered",
        icon: CircleHelp,
      },
      { href: "/dashboard/leads", label: "Leads", icon: ContactRound },
    ],
  },
  {
    section: "CONFIGURATION",
    items: [
      { href: "/dashboard/widget", label: "Website Widget", icon: Blocks },
      {
        href: "/dashboard/ai-config",
        label: "AI Configuration",
        icon: Settings2,
      },
      {
        href: "/dashboard/usage",
        label: "Usage & Analytics",
        icon: ChartNoAxesCombined,
      },
    ],
  },
  {
    section: "ACCOUNT",
    items: [
      { href: "/pricing", label: "Pricing & Plans", icon: CreditCard },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/auth/me"),
    retry: false,
  });

  if (me.isError) {
    if (
      typeof window !== "undefined" &&
      me.error instanceof ApiError &&
      me.error.status === 401
    ) {
      window.location.href = "/login";
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b12] p-10 text-center text-sm text-slate-400">
        {me.error instanceof ApiError && me.error.status === 401
          ? "Redirecting to sign-in…"
          : (me.error as Error).message}
      </div>
    );
  }

  if (!me.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090b12]">
        <Loading />
      </div>
    );
  }

  const { user, workspaces } = me.data;
  const ws = workspaces[0];

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(
      () => undefined
    );
    router.push("/login");
  }

  const sidebar = (
    <>
      <div className="flex h-[76px] items-center gap-3 border-b border-white/[0.07] px-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl ">
          <img
            src="/logo.png"
            alt="OmniBrain logo"
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight text-white">
            OmniBrain
          </div>
          <div className="text-[11px] text-slate-500">
            AI workspace
          </div>
        </div>
        {/* <Sparkles className="h-4 w-4 text-violet-400" /> */}
      </div>

      <div className="border-b border-white/[0.07] px-4 py-4">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          Current workspace
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-semibold text-violet-300">
            {(ws?.name || "O").trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-200">
              {ws?.name || "My workspace"}
            </div>
            <div className="mt-0.5 truncate text-xs capitalize text-slate-500">
              {ws?.plan || "starter"} plan
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
        </div>
      </div>

      <nav
        aria-label="Main navigation"
        className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
      >
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="mb-2 px-3 text-[10px] font-semibold tracking-[0.16em] text-slate-500">
              {group.section}
            </div>

            <div className="space-y-1">
              {group.items.map((item) => {
                const active =
                  item.href === "/dashboard"
                    ? pathname === item.href
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);

                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setNavOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-[10px] text-[13px] transition-colors duration-150",
                      active
                        ? "bg-violet-500/[0.13] font-medium text-violet-200"
                        : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-100"
                    )}
                  >
                    {active && (
                      <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-violet-400" />
                    )}
                    <Icon
                      className={cn(
                        "h-[17px] w-[17px] shrink-0 transition-colors",
                        active
                          ? "text-violet-300"
                          : "text-slate-500 group-hover:text-slate-300"
                      )}
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {active && (
                      <ChevronRight className="h-3.5 w-3.5 text-violet-400/80" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] p-4">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          {user.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar_url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-9 w-9 shrink-0 rounded-full border border-white/10 object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-slate-800 text-sm font-medium text-slate-200">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-slate-200">
              {user.name || user.email}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500">
              {user.email}
            </div>
          </div>
        </div>

        <button
          onClick={logout}
          className="mt-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-500 transition-colors hover:bg-red-500/[0.08] hover:text-red-300"
        >
          <LogOut className="h-4 w-4" strokeWidth={1.8} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#090b12] text-slate-100 md:flex md:h-screen md:overflow-hidden">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/[0.08] bg-[#090b12]/95 px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600">
            <BrainCircuit className="h-5 w-5 text-white" />
          </div>
          <span className="text-sm font-semibold text-white">
            OmniBrain
          </span>
        </div>

        <button
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen(!navOpen)}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition-colors hover:bg-white/5"
        >
          {navOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      </header>

      {navOpen && (
        <button
          aria-label="Close navigation overlay"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col border-r border-white/[0.08] bg-[#0d0f17] transition-transform duration-200 md:relative md:z-auto md:w-[252px] md:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {sidebar}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto bg-[#090b12]">
        <div className="mx-auto min-h-full max-w-[1600px] px-4 py-6 sm:px-6 md:px-8 md:py-8 lg:px-10">
          {me.data.role === "member" && (
            <div className="mb-6 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-4 py-3 text-sm text-sky-200">
              You have read-only access to this workspace. Ask an owner or
              admin to make changes.
            </div>
          )}

          {children}
        </div>
      </main>
    </div>
  );
}
