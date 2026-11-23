import { Suspense } from "react";
import { ListingDetail } from "@/components/app/listing-detail";

// The id is read client-side (useParams): all listing data lives in the client store.
export default function ListingPage() {
  return (
    <Suspense>
      <ListingDetail />
    </Suspense>
  );
}
