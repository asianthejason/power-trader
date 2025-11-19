// app/api/aeso/supply-cushion/route.ts
import { NextResponse } from "next/server";

export type CushionFlag = "tight" | "watch" | "comfortable" | "unknown";

export type HourlyPoint = {
  // ISO timestamp or "YYYY-MM-DD HH:00" – your choice, just keep consistent
  time: string;
  heLabel: string; // e.g. "HE 14"
  poolPrice?: number | null; // $/MWh
  smp?: number | null; // $/MWh, system marginal price
  ail?: number | null; // Alberta Internal Load (MW)
  availableSupply?: number | null; // total available generation MW
  imports?: number | null; // positive = importing, negative = exporting (MW)
  cushionMw?: number | null; // availableSupply - ail - reserves
  cushionPercent?: number | null; // cushionMw / ail
  cushionFlag: CushionFlag;
};

// Simple helper to categorize cushion
function classifyCushion(mw?: number | null, ail?: number | null): CushionFlag {
  if (mw == null || ail == null || ail <= 0) return "unknown";
  const pct = mw / ail;

  if (pct < 0.06) return "tight";       // < 6% reserve is very tight
  if (pct < 0.12) return "watch";       // “yellow” region
  return "comfortable";
}

// For now, use mock data so the UI works.
// Later: replace this with real scraping from AESO reports.
function buildMockData(): HourlyPoint[] {
  const base = new Date();
  base.setMinutes(0, 0, 0);

  const points: HourlyPoint[] = [];

  for (let i = 0; i < 24; i++) {
    const t = new Date(base);
    t.setHours(base.getHours() + i);
    const ail = 10_000 + Math.round(1000 * Math.sin(i / 24 * Math.PI * 2));
    const available = ail + 800 + (i < 6 || i > 20 ? 300 : 0); // tighter evening/morning
    const cushion = available - ail - 600; // pretend 600 MW reserves
    const cushionFlag = classifyCushion(cushion, ail);

    points.push({
      time: t.toISOString(),
      heLabel: `HE ${t.getHours().toString().padStart(2, "0")}`,
      poolPrice: cushionFlag === "tight" ? 250 : cushionFlag === "watch" ? 120 : 50,
      smp: cushionFlag === "tight" ? 260 : cushionFlag === "watch" ? 130 : 55,
      ail,
      availableSupply: available,
      imports: cushionFlag === "tight" ? 500 : 100,
      cushionMw: cushion,
      cushionPercent: cushion / ail,
      cushionFlag,
    });
  }

  return points;
}

export async function GET() {
  // 🔴 REAL SCRAPING LIVES HERE
  //
  // Example (pseudo-code only – you’ll need to tune to the real CSV/HTML):
  //
  // const csdRes = await fetch(
  //   "https://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet?contentType=csv",
  //   { cache: "no-store" }
  // );
  // const csdText = await csdRes.text();
  // const csdRows = parseCsv(csdText); // write a tiny CSV parser or use a lib
  //
  // Ditto for:
  // - Actual/Forecast pool price & AIL
  // - System Marginal Price
  // - Supply Adequacy & Market Supply Cushion
  //
  // Then map those into the HourlyPoint[] shape above.

  const data = buildMockData();

  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      points: data,
    },
    { status: 200 }
  );
}
