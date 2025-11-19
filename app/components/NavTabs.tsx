// app/components/NavTabs.tsx
import Link from "next/link";

const tabs = [
  { href: "/", label: "Dashboard" },
  { href: "/nearest-neighbour", label: "Nearest Neighbour" },
  { href: "/renewables", label: "Renewables" },
  { href: "/interties", label: "Interties" },
  { href: "/capability", label: "Market Capability" },
  { href: "/load-forecast", label: "Load & Price Forecast" },
];

export default function NavTabs() {
  return (
    <nav className="mb-4 border-b border-slate-800">
      <ul className="flex flex-wrap gap-2 text-sm">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              className="inline-flex items-center rounded-full border border-slate-700/70 bg-slate-900/60 px-3 py-1 text-xs font-medium text-slate-200 hover:border-sky-500/70 hover:bg-slate-900"
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
