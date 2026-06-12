// RP Runtime Nodes - Phase B

export { rpInputParserV1Definition, createRpInputParserV1Executor } from "./rpInputParserV1.js";

export {
  rpContextAssemblerV1Definition,
  createRpContextAssemblerV1Executor,
} from "./rpContextAssemblerV1.js";
export type { RpAssemblerConfig, RpAssemblerServices } from "./rpContextAssemblerV1.js";

export { rpWriterV1Definition, createRpWriterV1Executor } from "./rpWriterV1.js";
export type { LlmAdapter, RpWriterServices, RpWriterConfig } from "./rpWriterV1.js";

export {
  rpTimelineQueryV1Definition,
  createRpTimelineQueryV1Executor,
} from "./rpTimelineQueryV1.js";
export type { RpTimelineQueryServices, RpTimelineQueryConfig } from "./rpTimelineQueryV1.js";

export {
  rpLoreRetrieverV1Definition,
  createRpLoreRetrieverV1Executor,
} from "./rpLoreRetrieverV1.js";
export type { RpLoreRetrieverServices, RpLoreRetrieverConfig } from "./rpLoreRetrieverV1.js";

export {
  rpChapterSummaryV1Definition,
  createRpChapterSummaryV1Executor,
} from "./rpChapterSummaryV1.js";
export type {
  RpChapterSummaryServices,
  RpChapterSummaryConfig,
  ChapterPatch,
} from "./rpChapterSummaryV1.js";

export {
  rpTrackerUpdateV1Definition,
  createRpTrackerUpdateV1Executor,
} from "./rpTrackerUpdateV1.js";
export type { RpTrackerUpdateServices, RpTrackerUpdateConfig } from "./rpTrackerUpdateV1.js";

export { rpMemoryCommitV1Definition, createRpMemoryCommitV1Executor } from "./rpMemoryCommitV1.js";
export type { RpMemoryCommitServices, CommitResult } from "./rpMemoryCommitV1.js";

export { extractScope } from "./utils.js";
