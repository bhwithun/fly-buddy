import { cookies } from "next/headers";
import { Suspense } from "react";
import { Tracker } from "@/components/tracker";
import { ADDRESS_COOKIE, BUFFER_COOKIE, FLIGHT_COOKIE } from "@/lib/prefs";

export default async function Home() {
  const jar = await cookies();
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Tracker
        initialFlight={jar.get(FLIGHT_COOKIE)?.value ?? ""}
        initialAddress={jar.get(ADDRESS_COOKIE)?.value ?? ""}
        initialBuffer={jar.get(BUFFER_COOKIE)?.value ?? ""}
      />
    </Suspense>
  );
}
