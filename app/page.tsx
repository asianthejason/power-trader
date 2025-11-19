// app/page.tsx
import { HourlyPoint } from "./api/aeso/supply-cushion/route";

export const revalidate = 60; // re-fetch server data at most once per minute

async function fetchSupplyCushion(): Promise<{
  updatedAt: string;
  points: HourlyPoint[];
}> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/aeso/supply-cushion`, {
    // If NEXT_PUBLIC_BASE_URL is unset, Next will treat this as relative on the server.
    // You can also hard-code "/api/aeso/supply-cushion" for local development.
    next: { revalidate: 60 },
  }).catch(() => null as any);

  if (!res || !res.ok) {
    // In a real app you might want better error handling
    throw new Error("Failed to load supply cushion data");
  }

  return res.json();
}

function formatNumber(n?: number | null, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

function cushionFlagLabel(flag: HourlyPoint["cushionFlag"]) {
  switch (flag) {
    case "tight":
      return "Tight";
    case "watch":
      return "Watch";
    case "comfortable":
      return "Comfortable";
    default:
      return "Unknown";
  }
}

function cushionFlagClass(flag: HourlyPoint["cushionFlag"]) {
  switch (flag) {
    case "tight":
      return "bg-red-500/10 text-red-400 border-red-500/40";
    case "watch":
      return "bg-amber-500/10 text-amber-400 border-amber-500/40";
    case "comfortable":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/40";
    default:
      return "bg-slate-700/40 text-slate-300 border-slate-500/40";
  }
}

export default async function HomePage() {
  const { updatedAt, points } = await fetchSupplyCushion();
  const nowPoint = points[0]; // assuming first row is “current” or next hour
  const next24 = points.slice(0, 24);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Alberta Power Supply Cushion
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Live view of supply cushion, pool price, load and imports/exports to help you
              decide when to buy or sell power.
            </p>
          </div>

          <div className="flex flex-col items-start gap-1 text-xs text-slate-400 sm:items-end">
            <span>Last updated: {new Date(updatedAt).toLocaleString()}</span>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-medium">
              Prototype — wired for AESO reports & web scraping
            </span>
          </div>
        </header>

        {/* Top metrics */}
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Current Cushion
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(nowPoint?.cushionMw, 0)}{" "}
              <span className="text-base font-normal text-slate-400">MW</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {nowPoint?.cushionPercent != null
                ? `${(nowPoint.cushionPercent * 100).toFixed(1)}% of load`
                : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Pool Price (Forecast / SMP)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              ${formatNumber(nowPoint?.poolPrice, 0)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              SMP:{" "}
              {nowPoint?.smp != null ? `$${formatNumber(nowPoint.smp, 0)}` : "—"}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow">
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Alberta Internal Load (AIL)
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatNumber(nowPoint?.ail, 0)}{" "}
              <span className="text-base font-normal text-slate-400">MW</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Available: {formatNumber(nowPoint?.availableSupply, 0)} MW
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow flex flex-col justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                System Status
              </p>
              <div
                className={
                  "mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium " +
                  cushionFlagClass(nowPoint?.cushionFlag ?? "unknown")
                }
              >
                <span className="inline-block h-2 w-2 rounded-full bg-current" />
                {cushionFlagLabel(nowPoint?.cushionFlag ?? "unknown")}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Imports / exports:{" "}
              {formatNumber(nowPoint?.imports, 0)} MW{" "}
              <span className="text-slate-500">(positive = importing)</span>
            </p>
          </div>
        </section>

        {/* Hourly table */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Next 24 hours — hourly view
              </h2>
              <p className="text-xs text-slate-400">
                Each row is an hour ending (HE) with load, price and cushion. Low cushion
                + high price = tight system and good sell conditions.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Hour</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Pool Price</th>
                  <th className="px-3 py-2">SMP</th>
                  <th className="px-3 py-2">AIL (MW)</th>
                  <th className="px-3 py-2">Avail. Supply</th>
                  <th className="px-3 py-2">Cushion (MW)</th>
                  <th className="px-3 py-2">Cushion %</th>
                  <th className="px-3 py-2">Imports (MW)</th>
                  <th className="px-3 py-2">Flag</th>
                </tr>
              </thead>
              <tbody>
                {next24.map((pt, idx) => {
                  const isCurrentHour = idx === 0;
                  return (
                    <tr
                      key={pt.time}
                      className={
                        "border-t border-slate-800/60 " +
                        (isCurrentHour ? "bg-slate-900/70" : "hover:bg-slate-900/40")
                      }
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-300">
                        {pt.heLabel}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">
                        {new Date(pt.time).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        ${formatNumber(pt.poolPrice, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {pt.smp != null ? `$${formatNumber(pt.smp, 0)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(pt.ail, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(pt.availableSupply, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(pt.cushionMw, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {pt.cushionPercent != null
                          ? `${(pt.cushionPercent * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(pt.imports, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span
                          className={
                            "inline-flex rounded-full border px-2 py-0.5 " +
                            cushionFlagClass(pt.cushionFlag)
                          }
                        >
                          {cushionFlagLabel(pt.cushionFlag)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Roadmap: add separate tabs for wind/solar forecast, intertie ATC, BC/CAISO prices
            and trade recommendation signals (e.g., “export to BC now”, “import from Mid-C”).
          </p>
        </section>
      </div>
    </main>
  );
}
