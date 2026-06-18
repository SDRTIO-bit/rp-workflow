import type {
  CardImportWarningV1,
  ImportedGreetingV1,
  SillyTavernCardV3,
  CardParseLimits,
} from "./types.js";
import { DEFAULT_CARD_PARSE_LIMITS } from "./types.js";
import { sha256String } from "./hash.js";

// ---------------------------------------------------------------------------
// Cleaning patterns
// ---------------------------------------------------------------------------

// Status bar placeholders
const STATUS_BAR_PATTERNS = [
  /\{\{\s*status_bar\s*\}\}/gi,
  /\{\{\s*stats\s*\}\}/gi,
  /\{\{\s*status_\w*\s*\}\}/gi,
  /\{\{\s*getvar\s*:\s*status_\w*\s*\}\}/gi,
];

// Variable update tags (to be separated, not executed)
const VARIABLE_UPDATE_PATTERNS = [
  /\{\{\s*setvar\s*:[^}]*\}\}/gi,
  /\{\{\s*addvar\s*:[^}]*\}\}/gi,
  /\{\{\s*incvar\s*:[^}]*\}\}/gi,
  /\{\{\s*decvar\s*:[^}]*\}\}/gi,
  /\{\{var::set:[^}]*\}\}/gi,
];

// Remote content patterns
const REMOTE_CONTENT_PATTERNS = [
  /<script\s+[^>]*src\s*=\s*['"][^'"]+['"][^>]*>/gi,
  /<img\s+[^>]*src\s*=\s*['"]https?:[^'"]+['"][^>]*>/gi,
  /<iframe[\s\S]*?<\/iframe>/gi,
  /<iframe[\s\S]*?\/?>/gi,
  /\bimport\s*\(\s*['"][^'"]+['"]\s*\)/gi,
  /\bfetch\s*\(\s*['"][^'"]+['"]/gi,
  /\$\s*\(\s*['"]https?:[^'"]+['"]/gi,
  /\.load\s*\(\s*['"]https?:[^'"]+['"]/gi,
];

// JSON Patch patterns
const JSON_PATCH_PATTERNS = [
  /\{\s*"op"\s*:\s*"(replace|add|remove|move|copy|test)"/gi,
  /\{\{patch:[^}]*\}\}/gi,
];

// ---------------------------------------------------------------------------
// Clean a single greeting
// ---------------------------------------------------------------------------

export interface CleanedGreeting {
  cleaned: string;
  hadStatusBarPlaceholder: boolean;
  hadVariableUpdateTags: boolean;
  hadRemoteContent: boolean;
  hadUnappliedInitialPatch: boolean;
  removedFragmentSummary: string[];
  separatedVariableTags: string[];
  separatedRemoteRefs: string[];
}

export function cleanGreeting(raw: string): CleanedGreeting {
  let content = raw;
  const removedFragmentSummary: string[] = [];
  const separatedVariableTags: string[] = [];
  const separatedRemoteRefs: string[] = [];

  // 1. Status bar placeholder removal
  let hadStatusBarPlaceholder = false;
  for (const pat of STATUS_BAR_PATTERNS) {
    const matches = content.match(pat);
    if (matches) {
      hadStatusBarPlaceholder = true;
      for (const m of matches) {
        removedFragmentSummary.push(`removed status bar: ${m}`);
      }
      content = content.replace(pat, "");
    }
  }

  // 2. Variable update tag separation
  let hadVariableUpdateTags = false;
  for (const pat of VARIABLE_UPDATE_PATTERNS) {
    const matches = content.match(pat);
    if (matches) {
      hadVariableUpdateTags = true;
      for (const m of matches) {
        separatedVariableTags.push(m);
        removedFragmentSummary.push(`separated variable tag: ${m.slice(0, 60)}`);
      }
      content = content.replace(pat, "");
    }
  }

  // 3. Remote content removal
  let hadRemoteContent = false;
  for (const pat of REMOTE_CONTENT_PATTERNS) {
    const matches = content.match(pat);
    if (matches) {
      hadRemoteContent = true;
      for (const m of matches) {
        // Extract URL if present
        const urlMatch = m.match(/https?:\/\/[^\s'"<>]+/);
        if (urlMatch) {
          separatedRemoteRefs.push(urlMatch[0]);
        }
        removedFragmentSummary.push(`removed remote content: ${m.slice(0, 60)}`);
      }
      content = content.replace(pat, "");
    }
  }

  // 4. JSON Patch detection (do NOT apply)
  let hadUnappliedInitialPatch = false;
  for (const pat of JSON_PATCH_PATTERNS) {
    if (pat.test(content)) {
      hadUnappliedInitialPatch = true;
      removedFragmentSummary.push("detected unapplied JSON Patch");
      break;
    }
  }

  // 5. Whitespace normalization
  content = content.replace(/\n{3,}/g, "\n\n").trim();

  return {
    cleaned: content,
    hadStatusBarPlaceholder,
    hadVariableUpdateTags,
    hadRemoteContent,
    hadUnappliedInitialPatch,
    removedFragmentSummary,
    separatedVariableTags,
    separatedRemoteRefs,
  };
}

// ---------------------------------------------------------------------------
// Extract greetings from card
// ---------------------------------------------------------------------------

export interface ExtractedGreetings {
  greetings: ImportedGreetingV1[];
  defaultGreetingId: string | null;
  warnings: CardImportWarningV1[];
}

export function extractGreetings(
  card: SillyTavernCardV3,
  _limitsOverride?: Partial<CardParseLimits>,
): ExtractedGreetings {
  const _limits = { ...DEFAULT_CARD_PARSE_LIMITS, ..._limitsOverride };
  const warnings: CardImportWarningV1[] = [];
  const greetings: ImportedGreetingV1[] = [];

  // Check first_mes for remote content
  const firstMes = card.data.first_mes;
  if (firstMes && typeof firstMes === "string") {
    const hasRemote = /<iframe|<script|https?:\/\/[^\s]+/.test(firstMes);
    if (hasRemote || firstMes.length > 500) {
      warnings.push({
        code: "remote-first-mes",
        severity: "warn",
        message: "first_mes appears to be a remote placeholder and was not included",
        location: "data.first_mes",
        count: null,
      });
    }
  }

  // Extract alternate_greetings
  const alts = card.data.alternate_greetings;
  if (!alts || alts.length === 0) {
    return { greetings: [], defaultGreetingId: null, warnings };
  }

  for (let i = 0; i < alts.length; i++) {
    const alt = alts[i];
    if (!alt) continue;
    const rawContent = alt.greeting || "";
    const cleaned = cleanGreeting(rawContent);

    greetings.push({
      greetingId: `g${i}`,
      index: i,
      label: alt.label || alt.name || null,
      content: cleaned.cleaned,
      contentHash: sha256String(cleaned.cleaned),
      isDefault: false, // set below
      hadStatusBarPlaceholder: cleaned.hadStatusBarPlaceholder,
      hadVariableUpdateTags: cleaned.hadVariableUpdateTags,
      hadRemoteContent: cleaned.hadRemoteContent,
      hadUnappliedInitialPatch: cleaned.hadUnappliedInitialPatch,
      removedFragmentSummary: cleaned.removedFragmentSummary,
      separatedVariableTags: cleaned.separatedVariableTags,
      separatedRemoteRefs: cleaned.separatedRemoteRefs,
    });

    // Generate warnings for cleaning actions
    if (cleaned.hadStatusBarPlaceholder) {
      warnings.push({
        code: "greeting-status-bar-removed",
        severity: "info",
        message: `Status bar placeholder removed from greeting g${i}`,
        location: `greeting:g${i}`,
        count: null,
      });
    }
    if (cleaned.hadVariableUpdateTags) {
      warnings.push({
        code: "greeting-variable-tags-separated",
        severity: "warn",
        message: `Variable update tags separated from greeting g${i}`,
        location: `greeting:g${i}`,
        count: cleaned.separatedVariableTags.length,
      });
    }
    if (cleaned.hadRemoteContent) {
      warnings.push({
        code: "greeting-remote-content-removed",
        severity: "warn",
        message: `Remote content removed from greeting g${i}`,
        location: `greeting:g${i}`,
        count: cleaned.separatedRemoteRefs.length,
      });
    }
    if (cleaned.hadUnappliedInitialPatch) {
      warnings.push({
        code: "greeting-initial-patch-not-applied",
        severity: "warn",
        message: `JSON Patch detected in greeting g${i} but not applied`,
        location: `greeting:g${i}`,
        count: null,
      });
    }
  }

  // Default greeting selection
  let defaultGreetingId: string | null = null;
  if (greetings.length > 0) {
    // Prefer first non-remote greeting if g0 has remote content
    const g0 = greetings[0];
    if (g0 && g0.hadRemoteContent) {
      const nonRemote = greetings.find((g) => !g.hadRemoteContent);
      defaultGreetingId = nonRemote ? nonRemote.greetingId : (g0?.greetingId ?? null);
    } else {
      defaultGreetingId = g0?.greetingId ?? null;
    }

    // Mark default
    for (const g of greetings) {
      g.isDefault = g.greetingId === defaultGreetingId;
    }
  }

  return { greetings, defaultGreetingId, warnings };
}
