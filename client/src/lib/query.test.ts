import { describe, it, expect } from "vitest";
import {
  addFieldFilter,
  filterQuery,
  legacyParams,
  validPeriod,
  signInDestination,
} from "./query";
import { en, tr } from "./i18n";
describe("query and navigation contracts", () => {
  it("keeps legacy query fragments after login and rejects external redirect targets", () => {
    expect(signInDestination("/explore", "#/?query=level%3Aerror")).toBe(
      "/explore#/?query=level%3Aerror",
    );
    expect(signInDestination("//example.com")).toBe("/");
    expect(signInDestination("https://example.com")).toBe("/");
  });
  it("adds escaped field filters before a pipeline without treating a quoted pipe as a separator", () => {
    const q = addFieldFilter(
      '_msg:"a|b" | stats count()',
      "app.source",
      'x" | delete',
    );
    expect(q).toBe(
      '(_msg:"a|b") AND ("app.source":="x\\" | delete") | stats count()',
    );
    expect(addFieldFilter("*", "level", "warn", true)).toBe(
      '(*) AND NOT ("level":="warn")',
    );
  });
  it("preserves service names as literals when composing basic filters", () => {
    expect(filterQuery("*", 'api" OR *')).toContain(
      'compose_service:="api\\" OR *"',
    );
  });
  it("imports old bookmarks into the custom workspace without a native UI route", () => {
    const p = legacyParams(
      "#/?query=level%3Aerror&view=json&g0.range_input=12h",
    );
    expect(p.get("q")).toBe("level:error");
    expect(p.get("view")).toBe("json");
    expect(p.get("range")).toBe("12h");
  });
  it("rejects invalid, inverted and overly large custom time ranges", () => {
    expect(validPeriod({ start: "invalid", end: "2026-01-01Z" })).toBe(false);
    expect(
      validPeriod({
        start: "2026-01-02T00:00:00Z",
        end: "2026-01-01T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      validPeriod({
        start: "2026-01-01T00:00:00Z",
        end: "2026-03-01T00:00:00Z",
      }),
    ).toBe(false);
  });
  it("keeps interpolation parameters consistent across both translations", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const params = (v: string) =>
        [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(params(tr[key]), key).toEqual(params(en[key]));
    }
  });
});
