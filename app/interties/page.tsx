// app/interties/page.tsx
import NavTabs from "../components/NavTabs";
import { getTodayHourlyStates } from "../../lib/marketData";

export const revalidate = 60;

function formatNumber(n: number | null | undefined, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default async function IntertiesPage() {
  const states = await getTodayHourlyStates();

  const paths = ["AB-BC", "AB-SK", "AB-MATL"] as const;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Intertie View
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Synthetic ATC and scheduled flows on AB–BC, AB–SK, and AB–MATL. In
            production, this would be sourced from AESO&apos;s ATC grid,
            BPA/BCHYDRO paths, and your own TRM/firm rights logic.
          </p>
        </header>

        <NavTabs />

        <div className="space-y-6">
          {paths.map((path) => (
            <section
              key={path}
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"
            >
              <h2 className="mb-2 text-sm font-semibold tracking-tight">
                {path} Intertie
              </h2>
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/40">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2">HE</th>
                      <th className="px-3 py-2">Import ATC</th>
                      <th className="px-3 py-2">Export ATC</th>
                      <th className="px-3 py-2">Scheduled (MW)</th>
                      <th className="px-3 py-2">Actual Flow (MW)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.map((s) => {
                      const row = s.interties.find((i) => i.path === path);
                      if (!row) return null;
                      return (
                        <tr
                          key={`${s.he}-${path}`}
                          className="border-t border-slate-800/60 hover:bg-slate-900/40"
                        >
                          <td className="px-3 py-2 text-[11px] font-medium text-slate-200">
                            HE {s.he.toString().padStart(2, "0")}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.importCap, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.exportCap, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.scheduled, 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-300">
                            {formatNumber(row.actualFlow, 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Positive flow means Alberta importing; negative means exporting.
                In your trading logic you can combine this with BC/CAISO prices
                to spot spreads.
              </p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
