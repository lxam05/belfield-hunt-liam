import { Suspense } from "react";
import { MapView } from "@/components/app/map-view";

export default function MapPage() {
  return (
    <Suspense>
      <MapView />
    </Suspense>
  );
}
