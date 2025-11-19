// app/capability/page.tsx
import NavTabs from "../components/NavTabs";
import { getTodayHourlyStates, summarizeDay } from "../../lib/marketData";

export const revalidate = 60;

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default async function CapabilityPage() {
  const states = await getTodayHourlyStates();
  const summary = summarizeDay(states);
  const current = summary.current ?? states[0];

  // Aggregate outage by fuel across the day
  const fuelMap = new Map<
    string,
    { availAvg: number; outAvg: number; samples: number }
  >();

  states.forEach((s) => {
    s.capability.forEach((c) => {
      const entry = fuelMap.get(c.fuel) ?? {
        availAvg: 0,
        outAvg: 0,
        samples: 0,
      };
      entry.availAvg += c.availableMw;
      entry.outAvg += c.outageMw;
      entry.samples += 1;
      fuelMap.set(c.fuel, entry);
    });
  });

  const fuelRows = Array.from(fuelMap.entries()).map(([fuel, v]) => ({
    fuel,
    avail: v.availAvg / v.samples,
    out: v.outAvg / v.samples,
  }));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Market Capability
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Synthetic view of available MW and outages by fuel type. In
            production this would map to AESO&apos;s 7-Day Hourly Available
            Capability + outage data by resource.
          </p>
        </header>

        <NavTabs />

        {/* Current hour breakdown */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold tracking-tight">
            Current Hour Capability (HE {current.he.toString().padStart(2, "0")})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fuel</th>
                  <th className="px-3 py-2">Available (MW)</th>
                  <th className="px-3 py-2">Outage (MW)</th>
                </tr>
              </thead>
              <tbody>
                {current.capability.map((c) => (
                  <tr
                    key={c.fuel}
                    className="border-t border-slate-800/60 hover:bg-slate-900/40"
                  >
                    <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                      {c.fuel}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-300">
                      {formatNumber(c.availableMw, 0)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-300">
                      {formatNumber(c.outageMw, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Average over the day */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold tracking-tight">
            Average Capability Over the Day
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Fuel</th>
                  <th className="px-3 py-2">Avg Available (MW)</th>
                  <th className="px-3 py-2">Avg Outage (MW)</th>
                  <th className="px-3 py-2">Outage %</th>
                </tr>
              </thead>
              <tbody>
                {fuelRows.map((row) => {
                  const pct = row.avail + row.out === 0
                    ? 0
                    : (row.out / (row.avail + row.out)) * 100;
                  return (
                    <tr
                      key={row.fuel}
                      className="border-t border-slate-800/60 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                        {row.fuel}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(row.avail, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {formatNumber(row.out, 0)}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        {pct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            This mirrors the Excel &quot;Total Outage MW&quot; and resource
            availability sections. In the real implementation, wire this up to
            AESO&apos;s capability + outage feeds and track multi-day trends.
          </p>
        </section>
      </div>
    </main>
  );
}
