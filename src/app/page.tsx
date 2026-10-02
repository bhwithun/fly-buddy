import { cookies } from "next/headers";
import { Suspense } from "react";
import { Tracker } from "@/components/tracker";
import { ADDRESS_COOKIE, BUFFER_COOKIE, EARLY_COOKIE, FLIGHT_COOKIE, MODE_COOKIE } from "@/lib/prefs";

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const [jar, params] = await Promise.all([cookies(), searchParams]);
  const requested = one(params.mode);
  const saved = jar.get(MODE_COOKIE)?.value;
  const initialMode = requested === "dropoff" || requested === "pickup" ? requested : saved === "dropoff" ? "dropoff" : "pickup";
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Tracker
        initialFlight={jar.get(FLIGHT_COOKIE)?.value ?? ""}
        initialAddress={jar.get(ADDRESS_COOKIE)?.value ?? ""}
        initialBuffer={jar.get(BUFFER_COOKIE)?.value ?? ""}
        initialEarly={jar.get(EARLY_COOKIE)?.value ?? ""}
        initialMode={initialMode}
      />
    </Suspense>
  );
}
