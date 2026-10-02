import { Suspense } from "react";
import { Tracker } from "@/components/tracker";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <Tracker />
    </Suspense>
  );
}
