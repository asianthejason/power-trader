// app/capability/page.tsx
// or: src/app/capability/page.tsx  (depending on your project layout)

import { Suspense } from "react";
import {
  getTodayHourlyStates,
  summarizeDay,
  type HourlyState,
} from "../../lib/marketData";

export const revalidate = 60;

function formatHe(he: number): string {
  return he.toString().padStart(2, "0");
}

function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (!Number.isFinite(n ?? NaN)) return "—";
  return (n as number).toFixed(decimals);
}

function CapabilityTables({ states }: { states: HourlyState[] }) {
  const summary = summarizeDay(states);

  // If for some reason summarizeDay couldn't find a current hour,
  // fall back safely to the first HE in the list.
  const current = summary.current ?? states[0];

  // We currently do NOT have real capability data wired yet, because the
  // synthetic model has been removed. So we render empty tables with
  // a clear "not yet wired" note instead of fake numbers.
  const currentHe = current?.he ?? 1;

  const currentRow = states.find((s) => s.he === currentHe) ?? states[0];

  const currentCapability = currentRow?.capability ?? [];
  const allCapabilities = states.flatMap((s) => s.capability ?? []);

  return (
    <div className="space-y-8">
      {/* Top summary / header */}
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Market Capability (Real AESO Data – Capability Pending)
        </h1>
        <p className="text-sm text-neutral-400 max-w-3xl">
          This view is now based only on AESO&apos;s Actual/Forecast WMRQH
          report for load and pool price. The previous synthetic capability
          model has been removed. Capability by fuel will be wired to real
          AESO/ATC/outage feeds (e.g. 7-Day Hourly Available Capability,
          Supply Adequacy, CSD, etc.) in the next phase.
        </p>
        <p className="text-xs text-neutral-500">
          Report date: <span className="font-mono">{summary.date}</span> ·
          Current HE (approx):{" "}
          <span className="font-mono">{formatHe(currentHe)}</span>
        </p>
      </section>

      {/* Current hour "shell" table */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold">
            Current Hour Capability (HE {formatHe(currentHe)})
          </h2>
          <span className="text-xs text-amber-300">
            Capability by fuel not yet wired to real AESO sources – shown as
            empty.
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/60">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-900/80 text-neutral-300">
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
                    className="px-3 py-4 text-center text-neutral-500"
                  >
                    Capability data by fuel is not yet connected to real AESO
                    sources.
                  </td>
                </tr>
              ) : (
                currentCapability.map((row) => (
                  <tr key={row.fuel} className="border-t border-neutral-800">
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

      {/* Average capability shell table */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Average Capability Over the Day
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950/60">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-900/80 text-neutral-300">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fuel</th>
                <th className="px-3 py-2 text-right font-medium">
                  Avg Available (MW)
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  Avg Outage (MW)
                </th>
                <th className="px-3 py-2 text-right font-medium">Outage %</th>
              </tr>
            </thead>
            <tbody>
              {allCapabilities.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-4 text-center text-neutral-500"
                  >
                    Daily capability statistics will appear here once real
                    capability feeds are integrated.
                  </td>
                </tr>
              ) : (
                // This branch won’t be hit until capability is wired.
                Object.values(
                  allCapabilities.reduce<Record<string, CapabilityByFuel[]>>(
                    (acc, row) => {
                      if (!acc[row.fuel]) acc[row.fuel] = [];
                      acc[row.fuel].push(row);
                      return acc;
                    },
                    {}
                  )
                ).map((rowsForFuel) => {
                  const fuel = rowsForFuel[0].fuel;
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
                      className="border-t border-neutral-800"
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
    </div>
  );
}

export default async function CapabilityPage() {
  const states = await getTodayHourlyStates();

  if (!states.length) {
    return (
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Market Capability
        </h1>
        <p className="text-sm text-neutral-400 max-w-3xl">
          No AESO WMRQH data is available at build time, so this view cannot
          show capability yet. Once AESO data is reachable from the server
          and additional capability feeds are integrated, the tables here
          will populate with real values.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <Suspense fallback={null}>
        <CapabilityTables states={states} />
      </Suspense>
    </main>
  );
}

type CapabilityByFuel = import("../../lib/marketData").CapabilityByFuel;
