// app/capability/page.tsx

import NavTabs from "../components/NavTabs";
import {
  getTodayHourlyStates,
  summarizeDay,
  type HourlyState,
} from "../../lib/marketData";

export const revalidate = 60;

/* ---------- small helpers ---------- */

function formatHe(he: number): string {
  return he.toString().padStart(2, "0");
}

function formatNumber(
  n: number | null | undefined,
  decimals = 0
): string {
  if (n == null || Number.isNaN(n)) return "—";
  return (n as number).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "$—";
  return `$${formatNumber(n, 2)}`;
}

/* ---------- capability helpers (for when real data exists) ---------- */

type CapabilityByFuel = import("../../lib/marketData").CapabilityByFuel;

type CapabilityBuckets = Record<string, CapabilityByFuel[]>;

function bucketByFuel(rows: CapabilityByFuel[]): CapabilityBuckets {
  return rows.reduce<CapabilityBuckets>((acc, row) => {
    if (!acc[row.fuel]) acc[row.fuel] = [];
    acc[row.fuel].push(row);
    return acc;
  }, {});
}

/* ---------- main page ---------- */

export default async function CapabilityPage() {
  const states = await getTodayHourlyStates();

  // If we couldn't load WMRQH at all, show a graceful message.
  if (!states.length) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-4 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Market Capability
            </h1>
            <p className="max-w-2xl text-sm text-slate-400">
              This view depends on AESO data. Right now, no rows could be
              loaded from the Actual/Forecast WMRQH report, so the page
              cannot show current conditions or capability yet.
            </p>
          </header>

          <NavTabs />

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs text-slate-300">
            <p className="font-medium text-slate-200">
              No AESO WMRQH data available.
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Once the AESO report is reachable again, this page will show
              the latest load &amp; price from WMRQH and capability by fuel
              as we wire in additional feeds.
            </p>
          </section>
        </div>
      </main>
    );
  }

  const summary = summarizeDay(states);
  const current = summary.current ?? states[0];

  const currentHe = current.he;
  const currentLoadActual = current.actualLoad;
  const currentLoadForecast = current.forecastLoad;
  const currentPriceActual = current.actualPoolPrice;
  const currentPriceForecast = current.forecastPoolPrice;

  const currentCapability = current.capability ?? [];
  const allCapabilities = states.flatMap((s) => s.capability ?? []);
  const buckets = bucketByFuel(allCapabilities);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Page header */}
        <header className="mb-4 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Market Capability (Real AESO Load &amp; Price – Capability Pending)
          </h1>
          <p className="max-w-3xl text-sm text-slate-400">
            This view now uses only AESO&apos;s Actual/Forecast WMRQH report
            for load and pool price. The previous synthetic capability model
            has been removed. Capability by fuel will be wired to real AESO
            and outage feeds (e.g., 7-Day Hourly Available Capability,
            Supply Adequacy, CSD, etc.) in the next phase.
          </p>
        </header>

        {/* Shared nav bar */}
        <NavTabs />

        {/* Real-time summary banner using WMRQH-based states */}
        <section className="mt-4 rounded-2xl border border-sky-900 bg-sky-950/40 px-4 py-3 text-xs text-sky-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-900/80 px-3 py-1 text-[11px] font-medium">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span>SOURCE: AESO ActualForecastWMRQH (CSV)</span>
              </div>
              <div className="text-[11px] text-sky-200/80">
                Report date:{" "}
                <span className="font-mono">{summary.date}</span> · Current HE
                (approx):{" "}
                <span className="font-mono">
                  HE {formatHe(currentHe)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-sky-100/90">
                <span>
                  AIL (actual):{" "}
                  <span className="font-mono">
                    {formatNumber(currentLoadActual, 0)} MW
                  </span>
                </span>
                <span>
                  AIL (forecast):{" "}
                  <span className="font-mono">
                    {formatNumber(currentLoadForecast, 0)} MW
                  </span>
                </span>
                <span>
                  Pool Price (actual):{" "}
                  <span className="font-mono">
                    {formatPrice(currentPriceActual)}
                  </span>
                </span>
                <span>
                  Pool Price (forecast):{" "}
                  <span className="font-mono">
                    {formatPrice(currentPriceForecast)}
                  </span>
                </span>
              </div>
            </div>

            <p className="max-w-xs text-[11px] text-sky-200/80">
              Capability and outages by fuel will be populated from additional
              AESO reports (e.g., 7-Day Hourly Available Capability) once
              those feeds are connected. No synthetic values are shown here.
            </p>
          </div>
        </section>

        {/* Capability tables */}
        <section className="mt-6 space-y-8">
          {/* Current hour capability shell */}
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">
                Current Hour Capability (HE {formatHe(currentHe)})
              </h2>
              <span className="text-xs text-amber-300">
                Capability by fuel not yet wired to real AESO sources – shown
                as empty.
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Fuel</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Available (MW)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outage (MW)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {currentCapability.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        Capability data by fuel is not yet connected to real
                        AESO sources.
                      </td>
                    </tr>
                  ) : (
                    currentCapability.map((row) => (
                      <tr
                        key={row.fuel}
                        className="border-t border-slate-800"
                      >
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.fuel}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(row.availableMw)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatNumber(row.outageMw)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Average capability shell */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Average Capability Over the Day
            </h2>
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Fuel</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg Available (MW)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Avg Outage (MW)
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Outage %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allCapabilities.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-slate-500"
                      >
                        Daily capability statistics will appear here once real
                        capability feeds are integrated.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(buckets).map(([fuel, rowsForFuel]) => {
                      const count = rowsForFuel.length || 1;
                      const sumAvail = rowsForFuel.reduce(
                        (sum, r) => sum + (r.availableMw ?? 0),
                        0
                      );
                      const sumOut = rowsForFuel.reduce(
                        (sum, r) => sum + (r.outageMw ?? 0),
                        0
                      );
                      const avgAvail = sumAvail / count;
                      const avgOut = sumOut / count;
                      const outagePct =
                        avgAvail + avgOut > 0
                          ? (avgOut / (avgAvail + avgOut)) * 100
                          : 0;

                      return (
                        <tr
                          key={fuel}
                          className="border-t border-slate-800"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {fuel}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(avgAvail)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(avgOut)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatNumber(outagePct, 1)}%
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
