export const fmtNum = (n: number | null | undefined) => (n == null ? "–" : new Intl.NumberFormat().format(n));
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.endsWith("Z") || /[+-]\d\d:\d\d$/.test(iso) ? iso : iso + "Z").toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "–";
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export const fmtPct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);
