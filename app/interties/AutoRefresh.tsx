// src/app/interties/AutoRefresh.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AutoRefreshProps {
  intervalMs?: number;
}

/**
 * Client-side helper that triggers a route refresh on an interval.
 * This causes Next to re-run the server component and re-fetch data,
 * so the user sees new AESO values without manually reloading.
 */
export default function AutoRefresh({ intervalMs = 30000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null; // no UI
}
