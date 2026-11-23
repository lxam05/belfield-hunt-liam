"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VAPID_PUBLIC_KEY } from "@/lib/supabase/public-env";

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Optional Web Push subscription (only shown when VAPID keys are configured). */
export function PushToggle() {
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    setSupported(true); // eslint-disable-line react-hooks/set-state-in-effect
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then(setSub).catch(() => {});
  }, []);

  if (!supported) return null;

  async function enable() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast.error("Notifications are blocked for this site");
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s.toJSON()) });
      if (!res.ok) throw new Error("Saving the subscription failed");
      setSub(s);
      toast.success("Push notifications on for this device");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function disable() {
    if (!sub) return;
    await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
    setSub(null);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span>Push on this device</span>
      <Button size="sm" variant={sub ? "secondary" : "outline"} onClick={sub ? disable : enable}>
        {sub ? "On (turn off)" : "Turn on"}
      </Button>
    </div>
  );
}
