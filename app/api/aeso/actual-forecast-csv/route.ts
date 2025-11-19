// app/api/aeso/actual-forecast-csv/route.ts

const AESO_WMRQH_CSV_URL =
  "https://ets.aeso.ca/ets_web/ip/Market/Reports/ActualForecastWMRQHReportServlet?contentType=csv";

export async function GET() {
  try {
    const res = await fetch(AESO_WMRQH_CSV_URL, {
      cache: "no-store",
    });

    const text = await res.text();

    if (!res.ok) {
      return new Response(
        `Failed to fetch AESO CSV. HTTP ${res.status} ${res.statusText}\n\n${text}`,
        {
          status: 500,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }
      );
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // Browser will usually download; user can also open it directly.
        "Content-Disposition": `attachment; filename="ActualForecastWMRQH.csv"`,
      },
    });
  } catch (err) {
    console.error("Error proxying AESO CSV:", err);
    return new Response("Error proxying AESO CSV from AESO.", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}
