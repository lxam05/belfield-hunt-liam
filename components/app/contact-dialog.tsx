"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store/store";
import { logContact } from "@/lib/store/actions";
import type { ContactChannel, GroupProfile, ListingLite } from "@/lib/store/types";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_LABELS,
  fillTemplate,
  isMobile,
  splitSubject,
  toE164,
  type TemplateId,
} from "@/lib/contact/templates";

const CHANNEL: Record<TemplateId, ContactChannel> = {
  email: "email",
  daft: "daft-form",
  phone: "phone",
  whatsapp: "whatsapp",
};

/**
 * One-tap contact: fills the template, copies it, opens the right channel, logs the contact
 * and moves the pipeline to "contacted".
 */
export function ContactDialog({
  listing,
  open,
  onOpenChange,
}: {
  listing: ListingLite;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const settings = useStore((s) => s.settings);
  const profile = useMemo(() => (settings?.group_profile ?? {}) as GroupProfile, [settings]);
  const custom = useMemo(() => (settings?.templates ?? {}) as Partial<Record<TemplateId, string>>, [settings]);
  const phone = toE164(listing.seller_phone);
  const ids: TemplateId[] = phone ? ["daft", "phone", "whatsapp", "email"] : ["daft", "email", "phone"];
  const [tab, setTab] = useState<TemplateId>(ids[0]);
  const generated = useMemo(
    () => fillTemplate(custom[tab] || DEFAULT_TEMPLATES[tab], listing, profile),
    [custom, tab, listing, profile],
  );
  const [edited, setEdited] = useState<Record<string, string>>({});
  const text = edited[tab] ?? generated;

  async function go() {
    try {
      await navigator.clipboard.writeText(tab === "email" ? splitSubject(text).body : text);
      toast.success("Message copied to clipboard");
    } catch {
      toast.message("Couldn't copy automatically. Select the text and copy it.");
    }
    let href = listing.url;
    if (tab === "phone" && phone) href = `tel:+${phone}`;
    else if (tab === "whatsapp" && phone) href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    else if (tab === "email") {
      const { subject, body } = splitSubject(text);
      href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    if (href.startsWith("http")) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.href = href;
    await logContact(listing.id, CHANNEL[tab]);
    onOpenChange(false);
  }

  const goLabel =
    tab === "daft"
      ? "Copy & open Daft"
      : tab === "phone"
        ? phone
          ? "Copy script & call"
          : "Copy script & open Daft"
        : tab === "whatsapp"
          ? "Open WhatsApp"
          : "Copy & open email";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contact about {listing.title}</DialogTitle>
          <DialogDescription>
            {listing.seller_name ?? "Agent"}
            {listing.seller_phone ? ` · ${listing.seller_phone}` : ""}
            {!isMobile(phone) && tab === "whatsapp" ? " · this looks like a landline" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {ids.map((id) => (
            <Button key={id} size="sm" variant={tab === id ? "default" : "outline"} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {TEMPLATE_LABELS[id]}
            </Button>
          ))}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setEdited((s) => ({ ...s, [tab]: e.target.value }))}
          rows={12}
          className="font-mono text-xs leading-relaxed"
          aria-label="Message"
        />
        {!profile.contactName && (
          <p className="text-muted-foreground text-xs">Tip: fill in the group profile in Settings so messages are signed properly.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={go}>{goLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
