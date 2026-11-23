import { Suspense } from "react";
import { CompareView } from "@/components/app/compare-view";

export default function ComparePage() {
  return (
    <Suspense>
      <CompareView />
    </Suspense>
  );
}
