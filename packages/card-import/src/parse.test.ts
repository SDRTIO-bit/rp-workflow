import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSillyTavernCard, measureJsonDepth, CardImportError } from "./parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "__fixtures__");

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)));
}

describe("measureJsonDepth", () => {
  it("returns 0 for primitives", () => {
    expect(measureJsonDepth(null)).toBe(0);
    expect(measureJsonDepth(42)).toBe(0);
    expect(measureJsonDepth("str")).toBe(0);
  });

  it("returns 1 for flat object", () => {
    expect(measureJsonDepth({ a: 1 })).toBe(1);
  });

  it("returns correct depth for nested objects", () => {
    expect(measureJsonDepth({ a: { b: { c: 1 } } })).toBe(3);
  });

  it("handles arrays", () => {
    expect(measureJsonDepth([{ a: [1] }])).toBe(3);
  });
});

describe("parseSillyTavernCard", () => {
  it("L1: parses minimal V3 card", () => {
    const bytes = loadFixture("minimal-v3.json");
    const card = parseSillyTavernCard(bytes);
    expect(card.spec).toBe("chara_card_v3");
    expect(card.data.name).toBe("Test Character Alpha");
    expect(card.data.character_book?.entries).toHaveLength(1);
    expect(card.data.alternate_greetings).toHaveLength(1);
  });

  it("L2: parses card with no worldbook", () => {
    const bytes = loadFixture("no-worldbook-v3.json");
    const card = parseSillyTavernCard(bytes);
    expect(card.data.name).toBe("No Worldbook Character");
    expect(card.data.character_book).toBeUndefined();
  });

  it("L5: throws on corrupt JSON", () => {
    const bytes = loadFixture("corrupt.json");
    expect(() => parseSillyTavernCard(bytes)).toThrow(CardImportError);
    try {
      parseSillyTavernCard(bytes);
    } catch (e) {
      expect((e as CardImportError).code).toBe("invalid-json");
    }
  });

  it("L6: throws on non-V3 spec", () => {
    const bytes = loadFixture("not-v3.json");
    expect(() => parseSillyTavernCard(bytes)).toThrow(CardImportError);
    try {
      parseSillyTavernCard(bytes);
    } catch (e) {
      expect((e as CardImportError).code).toBe("unsupported-spec");
    }
  });

  it("throws on oversized file", () => {
    const bytes = new Uint8Array(100);
    expect(() => parseSillyTavernCard(bytes, { maxBytes: 50 })).toThrow(CardImportError);
    try {
      parseSillyTavernCard(bytes, { maxBytes: 50 });
    } catch (e) {
      expect((e as CardImportError).code).toBe("file-too-large");
    }
  });

  it("throws on too-deep JSON", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const bytes = new TextEncoder().encode(JSON.stringify(deep));
    expect(() => parseSillyTavernCard(bytes, { maxJsonDepth: 2 })).toThrow(CardImportError);
  });
});
