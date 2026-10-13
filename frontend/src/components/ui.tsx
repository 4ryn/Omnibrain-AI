"use client";
import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, forwardRef } from "react";
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
    danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  }[variant];
  return (
    <button {...rest} disabled={disabled || loading}
      className={cn("inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm", v, className)}>
      {loading && <Spinner className="h-3.5 w-3.5" />}{children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className ?? "h-5 w-5")} />;
}

const field = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) { return <input ref={ref} {...p} className={cn(field, className)} />; });
export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...p} className={cn(field, className)} />; }
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={cn(field, className)} />; }

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}{action}
        </div>)}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}</div>
      {action}
    </div>
  );
}

const tones = { gray: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800", red: "bg-red-100 text-red-800", blue: "bg-sky-100 text-sky-800", amber: "bg-amber-100 text-amber-800", indigo: "bg-brand-100 text-brand-700" };
export function Badge({ tone = "gray", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const tone = ({ completed: "green", failed: "red", processing: "blue", queued: "gray", open: "amber", resolved: "green", ignored: "gray" } as const)[status as "completed"] ?? "gray";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const c = { error: "border-red-200 bg-red-50 text-red-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800", info: "border-sky-200 bg-sky-50 text-sky-800", warning: "border-amber-200 bg-amber-50 text-amber-900" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center"><p className="font-medium text-slate-700">{title}</p>{children && <div className="mt-1 text-sm text-slate-500">{children}</div>}</div>;
}

export function Loading() { return <div className="flex justify-center py-12 text-brand-600"><Spinner className="h-6 w-6" /></div>; }

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>{sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}</div>;
}

export function DataTable<T>({ columns, data, onRowClick, activeId, getId }: { columns: ColumnDef<T, any>[]; data: T[]; onRowClick?: (row: T) => void; activeId?: string | null; getId?: (row: T) => string }) {
  const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} scope="col" className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>))}
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r.original) : undefined}
              className={cn(onRowClick && "cursor-pointer hover:bg-slate-50", activeId && getId && getId(r.original) === activeId && "bg-brand-50")}>
              {r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 align-top text-slate-700">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1, pages = Math.ceil(total / limit);
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
      <span>Page {page} of {pages} · {total} total</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return <Button variant="secondary" size="sm" type="button" onClick={async (e) => { const b = e.currentTarget; try { await navigator.clipboard.writeText(text); b.textContent = "Copied!"; } catch { b.textContent = "Copy failed"; } setTimeout(() => (b.textContent = label), 1500); }}>{label}</Button>;
}
