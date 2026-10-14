
"use client";

import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  forwardRef,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";

export const cn = (...a: (string | false | null | undefined)[]) =>
  a.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: BtnProps) {
  const variants = {
    primary:
      "border border-violet-500/30 bg-violet-600 text-white shadow-sm shadow-violet-950/20 hover:bg-violet-500",
    secondary:
      "border border-white/10 bg-white/[0.045] text-slate-200 hover:border-white/20 hover:bg-white/[0.08]",
    danger:
      "border border-red-400/20 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    ghost:
      "text-slate-400 hover:bg-white/[0.06] hover:text-white",
  };

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        variants[variant],
        className
      )}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "h-5 w-5"
      )}
    />
  );
}

const field =
  "w-full rounded-lg border border-white/10 bg-[#0c0e16] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40 disabled:cursor-not-allowed disabled:bg-white/[0.03] disabled:text-slate-500";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...p }, ref) {
  return <input ref={ref} {...p} className={cn(field, className)} />;
});

export function Textarea({
  className,
  ...p
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(field, "resize-y", className)} />;
}

export function Select({
  className,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={cn(field, "[color-scheme:dark]", className)}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-300">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs leading-5 text-slate-500">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-[#272a38] bg-[#11131d] shadow-sm shadow-black/10",
        className
      )}
    >
      {(title || action) && (
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[#272a38] px-5 py-4">
          {title && (
            <h2 className="text-sm font-semibold text-[#f4f4f8]">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}

      <div className="p-5">
        {children}
      </div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

const tones = {
  gray: "border-white/10 bg-white/[0.06] text-slate-300",
  green: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  red: "border-red-400/20 bg-red-400/10 text-red-300",
  blue: "border-sky-400/20 bg-sky-400/10 text-sky-300",
  amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  indigo: "border-violet-400/20 bg-violet-400/10 text-violet-300",
};

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}


export function StatusBadge({ status }: { status: string }) {
  const statusTones: Record<string, keyof typeof tones> = {
    completed: "green",
    failed: "red",
    processing: "blue",
    queued: "gray",
    open: "amber",
    resolved: "green",
    ignored: "gray",
  };

  return <Badge tone={statusTones[status] ?? "gray"}>{status}</Badge>;
}


export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "success" | "info" | "warning";
  children: ReactNode;
}) {
  const styles = {
    error:
      "border-red-400/20 bg-red-400/[0.07] text-red-200",
    success:
      "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200",
    info:
      "border-sky-400/20 bg-sky-400/[0.07] text-sky-200",
    warning:
      "border-amber-400/20 bg-amber-400/[0.07] text-amber-200",
  };

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 text-sm leading-6", styles[tone])}
    >
      {children}
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
      <p className="font-medium text-slate-200">{title}</p>
      {children && (
        <div className="mt-2 text-sm text-slate-500">{children}</div>
      )}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-12 text-violet-400">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.09] bg-[#11131d] p-5 shadow-sm shadow-black/10">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-xs leading-5 text-slate-400">{sub}</div>
      )}
    </div>
  );
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  activeId,
  getId,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  onRowClick?: (row: T) => void;
  activeId?: string | null;
  getId?: (row: T) => string;
}) {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.09] bg-[#11131d] shadow-sm shadow-black/10">
      <table className="min-w-full divide-y divide-white/[0.07] text-sm">
        <thead className="bg-white/[0.025]">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  scope="col"
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {table.getRowModel().rows.map((r) => {
            const active =
              !!activeId && !!getId && getId(r.original) === activeId;

            return (
              <tr
                key={r.id}
                onClick={
                  onRowClick ? () => onRowClick(r.original) : undefined
                }
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer hover:bg-white/[0.035]",
                  active && "bg-violet-500/[0.09]"
                )}
              >
                {r.getVisibleCells().map((c) => (
                  <td
                    key={c.id}
                    className="px-4 py-3 align-top text-slate-300"
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  total,
  offset,
  limit,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;

  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-400">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={async (e) => {
        const button = e.currentTarget;
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = "Copied!";
        } catch {
          button.textContent = "Copy failed";
        }
        setTimeout(() => {
          button.textContent = label;
        }, 1500);
      }}
    >
      {label}
    </Button>
  );
}
