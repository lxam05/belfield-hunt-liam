import type { Database } from "@/lib/supabase/database.types";

type T = Database["public"]["Tables"];
export type Listing = T["listings"]["Row"];
export type Commute = T["commutes"]["Row"];
export type Pipeline = T["pipeline"]["Row"];
export type Vote = T["votes"]["Row"];
export type Note = T["notes"]["Row"];
export type Contact = T["contact_log"]["Row"];
export type Member = T["members"]["Row"];
export type Destination = T["destinations"]["Row"];
export type Settings = T["settings"]["Row"];
export type Stage = Database["public"]["Enums"]["pipeline_stage"];
export type ContactChannel = Database["public"]["Enums"]["contact_channel"];

/** Listing as stored in the client, without the bulky raw JSON. */
export type ListingLite = Omit<Listing, "raw">;

export const STAGES: { id: Stage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "shortlisted", label: "Shortlisted" },
  { id: "contacting", label: "Contacting" },
  { id: "contacted", label: "Contacted" },
  { id: "viewing_booked", label: "Viewing booked" },
  { id: "viewed", label: "Viewed" },
  { id: "applied", label: "Applied" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "gone", label: "Gone" },
];

export interface GroupProfile {
  intro?: string;
  names?: string;
  occupations?: string;
  references?: string;
  budgetNote?: string;
  moveIn?: string;
  leaseLength?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface StoreState {
  ready: boolean;
  error: string | null;
  offline: boolean;
  me: Member | null;
  members: Member[];
  destinations: Destination[];
  settings: Settings | null;
  listings: Map<number, ListingLite>;
  commutes: Map<number, Commute[]>;
  pipeline: Map<number, Pipeline>;
  votes: Map<number, Vote[]>;
  notes: Map<number, Note[]>;
  contacts: Map<number, Contact[]>;
  /** Bumps on every change so memoized selectors can depend on it. */
  version: number;
}
