import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Offline" };

/** Served by the service worker when a page that was never cached is opened offline. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="text-4xl" aria-hidden>
        📡
      </div>
      <h1 className="text-lg font-semibold">You&apos;re offline</h1>
      <p className="text-muted-foreground text-sm">
        Open the Inbox to see the listings that were last loaded on this device. Claims and votes need a connection.
      </p>
      <Link href="/" className="text-primary text-sm underline">
        Go to Inbox
      </Link>
    </main>
  );
}
