import { effectiveBeds, formatEuro, perPersonRent } from "@/lib/budget";

/** Pure formatting for notifications (Telegram HTML + push text). Unit-tested. */

export interface NotifyListing {
  id: number;
  title: string;
  url: string;
  area: string | null;
  monthly_rent: number | null;
  price_is_from: boolean;
  price_on_application: boolean;
  beds: number | null;
  beds_min: number | null;
  beds_max: number | null;
  baths: number | null;
  property_type: string | null;
  image_cover: string | null;
  score: number | null;
}

export interface NotifyCommute {
  destination_id: string;
  mode: string;
  minutes: number | null;
  source: string;
  lines?: string[] | null;
}

export interface NotifyDestination {
  id: string;
  short_name: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "UCD 🚌 24m · 🚲 12m" chips; "~" marks estimates. */
export function commuteChips(dests: NotifyDestination[], commutes: NotifyCommute[]): string[] {
  return dests.map((d) => {
    const t = commutes.find((c) => c.destination_id === d.id && c.mode === "transit");
    const b = commutes.find((c) => c.destination_id === d.id && c.mode === "bicycle");
    const fmt = (c?: NotifyCommute) => (c?.minutes == null ? "?" : `${c.source === "estimate" ? "~" : ""}${c.minutes}m`);
    return `${d.short_name} 🚌 ${fmt(t)} · 🚲 ${fmt(b)}`;
  });
}

export function bedsLabel(l: Pick<NotifyListing, "beds" | "beds_min" | "beds_max">): string {
  if (l.beds != null) return `${l.beds} bed`;
  if (l.beds_min != null && l.beds_max != null) return `${l.beds_min}–${l.beds_max} bed`;
  return "? bed";
}

export function rentLabel(l: Pick<NotifyListing, "monthly_rent" | "price_is_from" | "price_on_application">): string {
  if (l.price_on_application || l.monthly_rent == null) return "Price on application";
  return `${l.price_is_from ? "From " : ""}${formatEuro(l.monthly_rent)}/mo`;
}

export function telegramCaption(
  l: NotifyListing,
  dests: NotifyDestination[],
  commutes: NotifyCommute[],
  maxPerPerson: number,
  appUrl: string,
): string {
  const pp = perPersonRent(l.monthly_rent, effectiveBeds(l));
  const ok = pp != null && pp <= maxPerPerson;
  const lines = [
    `🏠 <b>${escapeHtml(l.title)}</b>`,
    `${escapeHtml(rentLabel(l))} · <b>${pp == null ? "—" : formatEuro(pp)}/person</b> ${ok ? "✅" : "❌"}`,
    `${bedsLabel(l)}${l.baths != null ? ` · ${l.baths} bath` : ""}${l.property_type ? ` · ${escapeHtml(l.property_type)}` : ""}${l.area ? ` · ${escapeHtml(l.area)}` : ""}`,
    ...commuteChips(dests, commutes).map(escapeHtml),
    `⭐ Score <b>${l.score ?? "—"}</b>/100 · <a href="${appUrl}/listing/${l.id}">Open in app</a>`,
  ];
  return lines.join("\n").slice(0, 1024); // Telegram caption limit
}

export function telegramKeyboard(l: Pick<NotifyListing, "id" | "url">, claimedBy?: string | null) {
  return {
    inline_keyboard: [
      [{ text: "Open on Daft", url: l.url }],
      [
        claimedBy
          ? { text: `✋ ${claimedBy}`, callback_data: `noop:${l.id}` }
          : { text: "✋ Claim", callback_data: `claim:${l.id}` },
        { text: "⭐ Shortlist", callback_data: `short:${l.id}` },
        { text: "🙈 Hide", callback_data: `hide:${l.id}` },
      ],
    ],
  };
}

export function parseCallbackData(data: string | undefined): { action: string; listingId: number } | null {
  const m = data?.match(/^(claim|short|hide|noop):(\d{1,15})$/);
  return m ? { action: m[1], listingId: Number(m[2]) } : null;
}
