"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store/store";
import { useDestinations, useMe, useMembers, useSearchSettings, useWeights } from "@/lib/store/hooks";
import { applyToApify, scrapeNow, signOut, updateDestination, updateMember, updateSettings } from "@/lib/store/actions";
import { buildSweepUrls, isValidSlug } from "@/lib/daft/buildUrls";
import { DEFAULT_TEMPLATES, TEMPLATE_LABELS, type TemplateId } from "@/lib/contact/templates";
import type { GroupProfile } from "@/lib/store/types";
import type { ScoreWeights } from "@/lib/config/defaults";
import { MapView } from "./map-view";
import { PushToggle } from "./push-toggle";

const TABS = [
  ["search", "Search"],
  ["destinations", "Destinations"],
  ["ranking", "Ranking"],
  ["contact", "Templates & profile"],
  ["members", "Members"],
] as const;
type Tab = (typeof TABS)[number][0];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
    </label>
  );
}

function NumberInput({ value, onCommit, min, max, step = 1 }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number }) {
  const [v, setV] = useState(String(value));
  return (
    <Input
      type="number"
      inputMode="numeric"
      value={v}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max)) {
          setV(String(value));
          return toast.error(`Enter a number between ${min} and ${max}`);
        }
        if (n !== value) onCommit(n);
      }}
      className="h-9"
    />
  );
}

function SearchTab() {
  const s = useSearchSettings();
  const settings = useStore((st) => st.settings);
  const [slug, setSlug] = useState("");
  const [log, setLog] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const url = (() => {
    try {
      return buildSweepUrls(s)[0];
    } catch (e) {
      return (e as Error).message;
    }
  })();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Max € per person / month">
          <NumberInput value={s.maxPerPerson} min={300} max={1300} step={25} onCommit={(n) => updateSettings({ max_per_person: n })} />
        </Field>
        <Field label="Notify score ≥" hint="Telegram/push only above this">
          <NumberInput value={settings?.notify_score_threshold ?? 40} min={0} max={100} onCommit={(n) => updateSettings({ notify_score_threshold: n })} />
        </Field>
        <div />
        <Field label="Bedrooms min">
          <NumberInput value={s.bedsMin} min={1} max={s.bedsMax} onCommit={(n) => updateSettings({ beds_min: n })} />
        </Field>
        <Field label="Bedrooms max">
          <NumberInput value={s.bedsMax} min={s.bedsMin} max={8} onCommit={(n) => updateSettings({ beds_max: n })} />
        </Field>
        <div />
        <Field label="Group size min">
          <NumberInput value={s.groupSizeMin} min={1} max={s.groupSizeMax} onCommit={(n) => updateSettings({ group_size_min: n })} />
        </Field>
        <Field label="Group size max">
          <NumberInput value={s.groupSizeMax} min={s.groupSizeMin} max={8} onCommit={(n) => updateSettings({ group_size_max: n })} />
        </Field>
      </div>

      <div className="space-y-2">
        <Label>Daft areas (location slugs)</Label>
        <div className="flex flex-wrap gap-1.5">
          {s.locationSlugs.map((sl, i) => (
            <span key={sl} className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
              {i === 0 && <span title="Goes in the URL path">★</span>}
              {sl}
              <button
                aria-label={`Remove ${sl}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => s.locationSlugs.length > 1 && updateSettings({ daft_location_slugs: s.locationSlugs.filter((x) => x !== sl) })}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = slug.trim().toLowerCase();
            if (!isValidSlug(v)) return toast.error("Slugs look like dundrum-dublin (copy from a Daft search URL)");
            if (!s.locationSlugs.includes(v)) void updateSettings({ daft_location_slugs: [...s.locationSlugs, v] });
            setSlug("");
          }}
        >
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="e.g. dundrum-dublin" className="h-9" />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
        <p className="text-muted-foreground text-xs break-all">
          Search URL for the smallest unit:{" "}
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            {url}
          </a>
        </p>
      </div>

      <div className="space-y-1">
        <Label>When searches run</Label>
        <p className="text-muted-foreground text-sm">
          Only when someone presses <b>Find rentals</b>. Each press is a full search of Daft (up to{" "}
          {s.sweepResultsWanted} listings, about $0.25 on Apify). Nothing runs on a timer.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setLog(await applyToApify());
            setBusy(false);
          }}
        >
          {busy ? "Applying…" : "Apply to Apify"}
        </Button>
        <Button variant="outline" onClick={() => scrapeNow()}>
          Find rentals
        </Button>
        <Button variant="ghost" render={<Link href="/settings/costs" />} nativeButton={false}>
          Costs & health →
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Changes to budget, beds or areas only affect scraping after “Apply to Apify”.
        {settings?.apify_provisioned_at && ` Last applied ${new Date(settings.apify_provisioned_at).toLocaleString("en-IE")}.`}
      </p>
      {log && <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs">{log.join("\n")}</pre>}
    </div>
  );
}

function DestinationsTab() {
  const destinations = useDestinations();
  const members = useMembers();
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <Suspense>
          <MapView editDestinations heightClass="h-80" />
        </Suspense>
      </div>
      {destinations.map((d) => (
        <div key={d.id} className="space-y-2 rounded-xl border p-3">
          <div className="grid grid-cols-[3rem_1fr_6rem] gap-2">
            <Field label="Icon">
              <Input defaultValue={d.emoji} maxLength={4} className="h-9" onBlur={(e) => e.target.value !== d.emoji && updateDestination(d.id, { emoji: e.target.value })} />
            </Field>
            <Field label="Name">
              <Input defaultValue={d.name} className="h-9" onBlur={(e) => e.target.value !== d.name && updateDestination(d.id, { name: e.target.value })} />
            </Field>
            <Field label="Short">
              <Input defaultValue={d.short_name} className="h-9" maxLength={12} onBlur={(e) => e.target.value !== d.short_name && updateDestination(d.id, { short_name: e.target.value })} />
            </Field>
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            Pin at {d.lat.toFixed(5)}, {d.lng.toFixed(5)} (drag on the map above). Existing commutes aren&apos;t recomputed automatically; use “Recompute” on a listing.
          </p>
          <div className="text-sm">
            <div className="mb-1 font-medium">Who commutes here</div>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const explicit = d.who_commutes.length > 0;
                const on = explicit ? d.who_commutes.includes(m.id) : m.interns_at_sandyford === d.is_intern_site;
                return (
                  <label key={m.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={on}
                      onChange={(e) => {
                        const base = explicit ? d.who_commutes : members.filter((x) => x.interns_at_sandyford === d.is_intern_site).map((x) => x.id);
                        const next = e.target.checked ? [...new Set([...base, m.id])] : base.filter((x) => x !== m.id);
                        void updateDestination(d.id, { who_commutes: next });
                      }}
                    />
                    {m.display_name}
                  </label>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Default: {d.is_intern_site ? "members interning at Sandyford" : "members not at Sandyford"}. The score uses the worst-off commuter&apos;s time.
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RankingTab() {
  const w = useWeights();
  const labels: Record<keyof ScoreWeights, string> = {
    affordability: "Affordability: (cap − per person) / cap",
    commute: "Commute (worst-off member per destination)",
    freshness: "Freshness (newer = more urgent)",
    beds: "Bedrooms fit the group size",
    votes: "Group votes & stars",
  };
  return (
    <div className="space-y-4">
      {(Object.keys(labels) as (keyof ScoreWeights)[]).map((k) => (
        <div key={k} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>{labels[k]}</span>
            <span className="font-medium tabular-nums">{w[k]}</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            defaultValue={w[k]}
            className="accent-primary w-full"
            aria-label={labels[k]}
            onPointerUp={(e) => updateSettings({ score_weights: { ...w, [k]: Number((e.target as HTMLInputElement).value) } })}
            onKeyUp={(e) => updateSettings({ score_weights: { ...w, [k]: Number((e.target as HTMLInputElement).value) } })}
          />
        </div>
      ))}
      <p className="text-muted-foreground text-xs">Weights are relative; the score is normalised to 0–100. Tap any score badge to see its breakdown.</p>
    </div>
  );
}

function ContactTab() {
  const settings = useStore((s) => s.settings);
  const profile = (settings?.group_profile ?? {}) as GroupProfile;
  const templates = (settings?.templates ?? {}) as Partial<Record<TemplateId, string>>;
  const saveProfile = (k: keyof GroupProfile, v: string) => {
    if ((profile[k] ?? "") !== v) void updateSettings({ group_profile: { ...profile, [k]: v } });
  };
  const fields: [keyof GroupProfile, string, string][] = [
    ["intro", "Who we are", "We're 4 UCD students (2 interning at Sandyford) looking for a home together."],
    ["occupations", "Students / interns", "Two final-year engineering students and two interns at a fintech in Central Park."],
    ["references", "References", "References from previous landlords and employers available."],
    ["budgetNote", "Budget", "Up to €5,400/month"],
    ["moveIn", "Move-in date", "1 January"],
    ["leaseLength", "Lease length", "12-month"],
    ["contactName", "Sign as", "Aoife Byrne"],
    ["contactPhone", "Contact phone", "087 123 4567"],
    ["contactEmail", "Contact email", "aoife@example.com"],
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([k, label, ph]) => (
          <Field key={k} label={label}>
            {k === "intro" || k === "occupations" ? (
              <Textarea defaultValue={profile[k] ?? ""} placeholder={ph} rows={2} onBlur={(e) => saveProfile(k, e.target.value)} />
            ) : (
              <Input defaultValue={profile[k] ?? ""} placeholder={ph} className="h-9" onBlur={(e) => saveProfile(k, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Message templates</h3>
        <p className="text-muted-foreground text-xs">
          Placeholders: {"{{title}} {{rent}} {{beds}} {{area}} {{url}} {{agent}} {{intro}} {{occupations}} {{references}} {{moveIn}} {{leaseLength}} {{contactName}} {{contactPhone}} {{contactEmail}}"}
        </p>
        {(Object.keys(TEMPLATE_LABELS) as TemplateId[]).map((id) => (
          <Field key={id} label={TEMPLATE_LABELS[id]}>
            <Textarea
              defaultValue={templates[id] ?? DEFAULT_TEMPLATES[id]}
              rows={id === "daft" || id === "whatsapp" ? 4 : 9}
              className="font-mono text-xs"
              onBlur={(e) => {
                const v = e.target.value === DEFAULT_TEMPLATES[id] ? undefined : e.target.value;
                if (v !== templates[id]) void updateSettings({ templates: { ...templates, [id]: v } });
              }}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

function MembersTab() {
  const members = useMembers();
  const me = useMe();
  if (!me) return null;
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border p-3">
        <h3 className="text-sm font-semibold">My profile</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name">
            <Input defaultValue={me.display_name} className="h-9" onBlur={(e) => e.target.value.trim() && e.target.value !== me.display_name && updateMember(me.id, { display_name: e.target.value.trim() })} />
          </Field>
          <Field label="Colour">
            <input type="color" defaultValue={me.colour} className="h-9 w-16 rounded border" onBlur={(e) => updateMember(me.id, { colour: e.target.value })} />
          </Field>
          <Field label="Telegram user id" hint="Send /whoami to the bot in the group chat to get it.">
            <Input
              defaultValue={me.telegram_user_id ?? ""}
              inputMode="numeric"
              className="h-9"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && !/^\d{4,15}$/.test(v)) return toast.error("Telegram ids are numbers");
                const n = v ? Number(v) : null;
                if (n !== me.telegram_user_id) void updateMember(me.id, { telegram_user_id: n });
              }}
            />
          </Field>
          <Field label="My commute mode" hint="Used for the worst-off-member commute score.">
            <select className="bg-background h-9 w-full rounded-md border px-2" defaultValue={me.commute_mode} onChange={(e) => updateMember(me.id, { commute_mode: e.target.value })}>
              <option value="best">Fastest available</option>
              <option value="transit">Public transport</option>
              <option value="bicycle">Bike</option>
              <option value="walk">Walk</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary size-4" defaultChecked={me.interns_at_sandyford} onChange={(e) => updateMember(me.id, { interns_at_sandyford: e.target.checked })} />
            I intern at Sandyford Central Park
          </label>
          <PushToggle />
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Group ({members.length})</h3>
        <ul className="divide-y rounded-xl border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 p-2 text-sm">
              <span className="size-3 rounded-full" style={{ background: m.colour }} />
              <span className="font-medium">{m.display_name}</span>
              <span className="text-muted-foreground ml-auto text-xs">
                {m.role}
                {m.interns_at_sandyford ? " · Sandyford" : ""}
                {m.telegram_user_id ? " · TG ✓" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-muted-foreground text-xs">
        New people join by entering the group password with their name on the sign-in page.
      </p>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("search");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 pt-3 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Link href="/settings/costs" className="text-primary text-sm underline">
          Costs & health
        </Link>
      </div>
      <div className="-mx-3 flex gap-1 overflow-x-auto px-3" role="tablist">
        {TABS.map(([id, label]) => (
          <Button key={id} size="sm" role="tab" aria-selected={tab === id} variant={tab === id ? "default" : "outline"} onClick={() => setTab(id)}>
            {label}
          </Button>
        ))}
      </div>
      {tab === "search" && <SearchTab />}
      {tab === "destinations" && <DestinationsTab />}
      {tab === "ranking" && <RankingTab />}
      {tab === "contact" && <ContactTab />}
      {tab === "members" && <MembersTab />}
    </div>
  );
}
