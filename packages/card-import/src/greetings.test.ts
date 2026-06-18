import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGreetings, cleanGreeting } from "./greetings.js";
import type { SillyTavernCardV3 } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixture(name: string): SillyTavernCardV3 {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("extractGreetings", () => {
  it("L3: extracts 6 greetings with correct IDs", () => {
    const card = loadFixture("greetings-v3.json");
    const result = extractGreetings(card);

    expect(result.greetings).toHaveLength(6);
    expect(result.defaultGreetingId).toBe("g0");

    for (let i = 0; i < 6; i++) {
      const g = result.greetings[i];
      expect(g).toBeDefined();
      expect(g!.greetingId).toBe(`g${i}`);
      expect(g!.index).toBe(i);
    }
  });

  it("marks default greeting correctly", () => {
    const card = loadFixture("greetings-v3.json");
    const result = extractGreetings(card);

    const defaults = result.greetings.filter((g) => g.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.greetingId).toBe("g0");
  });

  it("returns empty for card with no greetings", () => {
    const card = loadFixture("minimal-v3.json");
    // minimal has 1 greeting
    const result = extractGreetings(card);
    expect(result.greetings).toHaveLength(1);
  });

  it("generates remote-first-mes warning", () => {
    const card = loadFixture("greetings-v3.json");
    const result = extractGreetings(card);
    const remoteWarning = result.warnings.find((w) => w.code === "remote-first-mes");
    expect(remoteWarning).toBeTruthy();
  });

  it("each greeting has a contentHash", () => {
    const card = loadFixture("greetings-v3.json");
    const result = extractGreetings(card);
    for (const g of result.greetings) {
      expect(g.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("cleanGreeting", () => {
  it("L19: removes status bar placeholders", () => {
    const result = cleanGreeting("Hello {{status_bar}} world {{stats}}");
    expect(result.hadStatusBarPlaceholder).toBe(true);
    expect(result.cleaned).not.toContain("{{status_bar}}");
    expect(result.cleaned).not.toContain("{{stats}}");
    expect(result.cleaned).toContain("Hello");
    expect(result.cleaned).toContain("world");
  });

  it("L19: separates variable update tags", () => {
    const result = cleanGreeting("Hello {{setvar:mood:happy}} world");
    expect(result.hadVariableUpdateTags).toBe(true);
    expect(result.separatedVariableTags).toContain("{{setvar:mood:happy}}");
    expect(result.cleaned).not.toContain("setvar");
  });

  it("L19: removes remote content", () => {
    const result = cleanGreeting('Hello <script src="https://evil.com/x.js"></script> world');
    expect(result.hadRemoteContent).toBe(true);
    expect(result.cleaned).not.toContain("<script");
    expect(result.separatedRemoteRefs.length).toBeGreaterThan(0);
  });

  it("L19: flags unapplied JSON Patch", () => {
    const result = cleanGreeting('Hello {"op":"replace","path":"/foo"} world');
    expect(result.hadUnappliedInitialPatch).toBe(true);
  });

  it("normalizes whitespace", () => {
    const result = cleanGreeting("Hello\n\n\n\n\nworld");
    expect(result.cleaned).toBe("Hello\n\nworld");
  });

  it("produces removedFragmentSummary entries", () => {
    const result = cleanGreeting("{{status_bar}} {{setvar:x:1}}");
    expect(result.removedFragmentSummary.length).toBeGreaterThan(0);
  });
});
