import { describe, expect, it } from "vitest";
import { batchTitle } from "../src/batch-title.ts";

describe("batch titles", () => {
  it("names the sections of definition changes", () => {
    expect(
      batchTitle([
        { type: "definition_change", payload: { section: "Quality goals" } },
        { type: "definition_change", payload: { section: "What the first version does" } },
      ]),
    ).toBe("2 changes to the product definition: Quality goals, What the first version does");
  });
  it("counts quality requirements and names a single record", () => {
    const nfr = { type: "design_record", payload: { record_type: "quality_requirement", title: "Fast" } };
    expect(batchTitle([nfr, nfr, nfr])).toBe("3 quality requirements (NFR) from your quality goals");
    expect(batchTitle([nfr])).toBe("Quality requirement (NFR): Fast");
  });
  it("joins different kinds", () => {
    expect(
      batchTitle([
        { type: "definition_change", payload: { section: "Purpose" } },
        { type: "record_change", payload: { record: { code: "FDR-A-001" } } },
      ]),
    ).toBe("1 change to the product definition: Purpose · 1 change to FDR-A-001");
  });
});
