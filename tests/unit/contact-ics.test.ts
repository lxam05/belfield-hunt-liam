import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, fillTemplate, isMobile, splitSubject, toE164 } from "@/lib/contact/templates";
import { buildIcs } from "@/lib/ics";

const listing = {
  title: "39 Abbeyfield, Milltown, Dublin 6",
  url: "https://www.daft.ie/for-rent/39-abbeyfield-milltown-dublin-6/6727385",
  area: "Dublin 6",
  monthly_rent: 3100,
  beds: 3,
  seller_name: "Hunters Estate Agent",
};

describe("contact templates", () => {
  it("fills every placeholder", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      const out = fillTemplate(t, listing, { contactName: "Aoife", contactPhone: "087 123 4567", moveIn: "1 January" });
      expect(out).not.toMatch(/\{\{/);
      expect(out).toContain("Aoife");
    }
  });
  it("uses listing details and falls back gracefully", () => {
    const out = fillTemplate(DEFAULT_TEMPLATES.email, { ...listing, seller_name: "Private landlord" }, {});
    expect(out).toContain("€3,100/month");
    expect(out).toContain("Hi there,");
    expect(splitSubject(out).subject).toBe("Viewing request: 39 Abbeyfield, Milltown, Dublin 6");
  });
  it("normalizes Irish phone numbers", () => {
    expect(toE164("087 123 4567")).toBe("353871234567");
    expect(toE164("+353 1 497 0011")).toBe("35314970011");
    expect(toE164("00353871234567")).toBe("353871234567");
    expect(toE164("12")).toBeNull();
    expect(isMobile("353871234567")).toBe(true);
    expect(isMobile("35314970011")).toBe(false);
  });
});

describe("ics export", () => {
  it("produces a valid calendar with escaped text and CRLF", () => {
    const ics = buildIcs(
      [{ uid: "1", start: new Date("2026-11-24T18:00:00Z"), title: "Viewing: 39 Abbeyfield, Milltown", location: "Dublin 6; gate code" }],
      new Date("2026-11-20T00:00:00Z"),
    );
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261124T180000Z");
    expect(ics).toContain("DTEND:20261124T183000Z");
    expect(ics).toContain("SUMMARY:Viewing: 39 Abbeyfield\\, Milltown");
    expect(ics).toContain("LOCATION:Dublin 6\\; gate code");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
