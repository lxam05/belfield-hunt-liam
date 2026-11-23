import type { GroupProfile } from "@/lib/store/types";
import { formatEuro } from "@/lib/budget";

/** Enquiry templates. `{{placeholders}}` are filled from the listing + group profile. */

export type TemplateId = "email" | "daft" | "phone" | "whatsapp";

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  email: "Email",
  daft: "Daft message form",
  phone: "Phone script",
  whatsapp: "WhatsApp / SMS",
};

export const DEFAULT_TEMPLATES: Record<TemplateId, string> = {
  email: `Subject: Viewing request: {{title}}

Hi {{agent}},

I'm getting in touch about {{title}} ({{rent}}), listed on Daft ({{url}}).

{{intro}}
{{occupations}}

- Move-in: {{moveIn}}
- Lease: {{leaseLength}}
- References: {{references}}

We'd love to view it at your earliest convenience and can be flexible on times.

Many thanks,
{{contactName}}
{{contactPhone}}
{{contactEmail}}`,
  daft: `Hi {{agent}}, we're very interested in {{title}}. {{intro}} {{occupations}} Move-in {{moveIn}}, {{leaseLength}} lease, {{references}}. Could we arrange a viewing? You can reach {{contactName}} on {{contactPhone}}. Thanks!`,
  phone: `Hi, my name is {{contactName}}. I'm calling about the {{beds}} in {{area}} listed on Daft at {{rent}}.

• Is it still available?
• {{intro}} {{occupations}}
• We're looking to move in {{moveIn}} for {{leaseLength}}; {{references}}.
• Could we book a viewing? When suits you?
• Ask: deposit amount, what's included (bills/broadband), parking/bike storage, RTB registration.

Leave a callback number: {{contactPhone}}`,
  whatsapp: `Hi {{agent}}, I'm enquiring about {{title}} ({{rent}}) on Daft. {{intro}} Move-in {{moveIn}}, {{leaseLength}}. Could we view it? Thanks, {{contactName}}`,
};

export interface TemplateListing {
  title: string;
  url: string;
  area: string | null;
  monthly_rent: number | null;
  price_is_from?: boolean;
  beds: number | null;
  beds_min?: number | null;
  beds_max?: number | null;
  seller_name: string | null;
}

export function fillTemplate(template: string, l: TemplateListing, p: GroupProfile): string {
  const beds =
    l.beds != null ? `${l.beds}-bed` : l.beds_min != null && l.beds_max != null ? `${l.beds_min}–${l.beds_max} bed` : "property";
  const vars: Record<string, string> = {
    title: l.title,
    url: l.url,
    area: l.area ?? "Dublin",
    rent: l.monthly_rent != null ? `${l.price_is_from ? "from " : ""}${formatEuro(l.monthly_rent)}/month` : "price on application",
    beds,
    agent: l.seller_name && !/private/i.test(l.seller_name) ? l.seller_name : "there",
    intro: p.intro?.trim() || "We're a small group of UCD students looking for a home together.",
    occupations: p.occupations?.trim() || "",
    names: p.names?.trim() || "",
    references: p.references?.trim() || "references available from previous landlords",
    budget: p.budgetNote?.trim() || "",
    moveIn: p.moveIn?.trim() || "as soon as it's available",
    leaseLength: p.leaseLength?.trim() || "a 12-month",
    contactName: p.contactName?.trim() || "",
    contactPhone: p.contactPhone?.trim() || "",
    contactEmail: p.contactEmail?.trim() || "",
  };
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split "Subject: …" off an email template body. */
export function splitSubject(text: string): { subject: string; body: string } {
  const m = text.match(/^Subject:\s*(.+)\n+/);
  return m ? { subject: m[1].trim(), body: text.slice(m[0].length) } : { subject: "Rental enquiry", body: text };
}

/** Irish numbers → E.164 digits for wa.me / tel: links. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `353${d.slice(1)}`;
  return d.length >= 9 ? d : null;
}

export function isMobile(e164: string | null): boolean {
  return !!e164 && /^3538[3-9]/.test(e164);
}
