// app/api/aeso/wind-shortterm-csv/route.ts

const AESO_WIND_12H_URL =
  "http://ets.aeso.ca/Market/Reports/Manual/Operations/prodweb_reports/wind_solar_forecast/wind_rpt_shortterm.csv";

export async function GET() {
  try {
    const upstream = await fetch(AESO_WIND_12H_URL, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AlbertaPowerTraderBot/1.0; +https://power-trader.vercel.app)",
      },
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return new Response(
        `Failed to fetch AESO wind short-term CSV. HTTP ${upstream.status} ${upstream.statusText}\n\n${text}`,
        { status: upstream.status }
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="wind_rpt_shortterm.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error fetching AESO wind short-term CSV:", err);
    return new Response(
      `Error fetching AESO wind short-term CSV: ${(err as Error).message}`,
      { status: 500 }
    );
  }
}
