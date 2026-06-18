import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectBlockedFeatures,
  detectCapabilities,
  hasVariableCondition,
  hasBlockedScript,
} from "./detect.js";
import type { SillyTavernCardV3 } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixture(name: string): SillyTavernCardV3 {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("detectBlockedFeatures", () => {
  it("L9: detects remote scripts and eval", () => {
    const card = loadFixture("remote-scripts-v3.json");
    const features = detectBlockedFeatures(card);

    const codes = features.map((f) => f.code);
    expect(codes).toContain("eval");
    expect(codes).toContain("script-tag");
    expect(codes).toContain("regex-script");
    expect(codes).toContain("helper-script");
  });

  it("produces no false positives on clean card", () => {
    const card = loadFixture("minimal-v3.json");
    const features = detectBlockedFeatures(card);
    expect(features).toHaveLength(0);
  });

  it("each feature has count > 0 and non-null evidence", () => {
    const card = loadFixture("remote-scripts-v3.json");
    const features = detectBlockedFeatures(card);
    for (const f of features) {
      expect(f.count).toBeGreaterThan(0);
      expect(f.evidence).toBeTruthy();
    }
  });
});

describe("detectCapabilities", () => {
  it("L10: detects variable conditions", () => {
    const card = loadFixture("var-conditions-v3.json");
    const entries = card.data.character_book?.entries || [];
    const caps = detectCapabilities(card, entries);

    expect(caps.variablesDetected).toBe(true);
    expect(caps.conditionalEntriesDetected).toBe(true);
    expect(caps.runtimeStatus).toBe("unsupported-runtime");
    expect(caps.conditionalEntryIds.length).toBeGreaterThan(0);
  });

  it("detects variable schema / initial state in extensions", () => {
    const card = loadFixture("var-conditions-v3.json");
    const entries = card.data.character_book?.entries || [];
    const caps = detectCapabilities(card, entries);

    expect(caps.initialStateDetected).toBe(true);
    expect(caps.initialStateLocation).toBeTruthy();
  });

  it("clean card has no capabilities detected", () => {
    const card = loadFixture("minimal-v3.json");
    const entries = card.data.character_book?.entries || [];
    const caps = detectCapabilities(card, entries);

    expect(caps.variablesDetected).toBe(false);
    expect(caps.conditionalEntriesDetected).toBe(false);
  });
});

describe("hasVariableCondition", () => {
  it("detects EJS patterns", () => {
    expect(hasVariableCondition("<% if (x) { %>")).toBe(true);
  });

  it("detects getvar patterns", () => {
    expect(hasVariableCondition("{{getvar:score}}")).toBe(true);
  });

  it("detects setvar patterns", () => {
    expect(hasVariableCondition("{{setvar:x:1}}")).toBe(true);
  });

  it("detects MVU patterns", () => {
    expect(hasVariableCondition("{{var::set:counter:5}}")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(hasVariableCondition("Just normal text.")).toBe(false);
  });
});

describe("hasBlockedScript", () => {
  it("detects eval", () => {
    expect(hasBlockedScript("eval(something)")).toBe(true);
  });

  it("detects script tags", () => {
    expect(hasBlockedScript("<script>alert(1)</script>")).toBe(true);
  });

  it("detects new Function", () => {
    expect(hasBlockedScript("new Function('return 1')")).toBe(true);
  });

  it("returns false for clean text", () => {
    expect(hasBlockedScript("Just normal text.")).toBe(false);
  });

  // ---- Positive cases from P-15.3A-1 spec ----

  it("detects fetch with a URL string literal", () => {
    expect(hasBlockedScript('fetch("https://example.com")')).toBe(true);
  });

  it("detects dynamic import() with a URL", () => {
    expect(hasBlockedScript('import("https://example.com/x.js")')).toBe(true);
  });

  it("detects static import from a URL", () => {
    expect(hasBlockedScript('import x from "https://example.com/x.js"')).toBe(true);
  });

  it("detects iframe tag", () => {
    expect(hasBlockedScript('<iframe src="https://example.com">')).toBe(true);
  });

  it("detects new Function('...')", () => {
    expect(hasBlockedScript('new Function("return 1")')).toBe(true);
  });

  it("detects bare eval('...')", () => {
    expect(hasBlockedScript('eval("alert(1)")')).toBe(true);
  });

  // ---- Negative cases from P-15.3A-1 spec ----
  // Plain English prose must NOT be classified as blocked script.

  it("does NOT flag: 'She went to fetch water.'", () => {
    expect(hasBlockedScript("She went to fetch water.")).toBe(false);
  });

  it("does NOT flag: 'This is important information.'", () => {
    expect(hasBlockedScript("This is important information.")).toBe(false);
  });

  it("does NOT flag: 'The iframe was mentioned as a word.'", () => {
    expect(hasBlockedScript("The iframe was mentioned as a word.")).toBe(false);
  });

  it("does NOT flag: prose with 'npm' but not 'npm install'", () => {
    expect(hasBlockedScript("She typed npm at the prompt.")).toBe(false);
  });

  it("does NOT flag: prose with 'import' but no URL or parens", () => {
    expect(hasBlockedScript("I want to import a new character concept.")).toBe(false);
  });
});

describe("hasVariableCondition - prose negative cases", () => {
  it("does NOT flag: prose mentioning 'variable' or 'getvar' as English", () => {
    expect(hasVariableCondition("The variable temperature is rising.")).toBe(false);
  });

  it("does NOT flag: prose mentioning 'setvar' as a word", () => {
    expect(hasVariableCondition("We setvar our expectations.")).toBe(false);
  });

  it("does NOT flag: prose containing '<' or '%' but not '<%'", () => {
    expect(hasVariableCondition("Less than 5% of users clicked.")).toBe(false);
  });
});
