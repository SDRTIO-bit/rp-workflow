/**
 * Default RP Preset - Phase B-2.6.1
 *
 * 中文默认 RP 预设，维持当前 Writer 行为。
 */

import type { RpPresetV1 } from "./types.js";

/**
 * 默认 RP 预设。
 *
 * 规则：
 * - 不替玩家决定新的行动、对白或心理
 * - 保持角色的认知边界
 * - 不直接泄露隐藏世界书或 Runtime 内部信息
 * - 保持地点、时间、人物和动作的连续性
 * - 只输出玩家可见的角色扮演内容
 * - 不输出 JSON、分析或调试信息
 */
export const DEFAULT_RP_PRESET: RpPresetV1 = {
  version: "rp-preset-v1",
  id: "rp-default-v1",
  name: "默认 RP 写作",

  model: {
    temperature: 0.8,
    maxOutputTokens: 2048,
  },

  prompt: {
    coreRules: [
      {
        id: "core-no-player-control",
        content: "1. 不替玩家决定新的行动、对白或心理。只有玩家能控制自己的角色。",
        priority: 100,
      },
      {
        id: "core-cognitive-boundary",
        content: "2. 保持角色的认知边界。角色不能知道他们没有亲身经历或被告知的信息。",
        priority: 100,
      },
      {
        id: "core-no-leak-secrets",
        content:
          "3. 不以旁白说明方式直接泄露隐藏世界书或 Runtime 内部信息。秘密可以影响角色行为，但不能直接陈述。",
        priority: 100,
      },
      {
        id: "core-continuity",
        content: "4. 保持地点、时间、人物和动作的连续性。不要瞬移角色或跳过逻辑后果。",
        priority: 100,
      },
      {
        id: "core-rp-visible-only",
        content: "5. 只输出玩家可见的角色扮演内容。不输出状态栏、JSON、分析或元评论。",
        priority: 100,
      },
    ],

    styleRules: [
      {
        id: "style-show-dont-tell",
        content: "通过动作、肢体语言和对白来展示情感，而不是直接陈述。",
        priority: 80,
      },
      {
        id: "style-sensory-detail",
        content: "包含感官细节（视觉、听觉、嗅觉、触觉）来增强场景沉浸感。",
        priority: 70,
      },
      {
        id: "style-voice-consistency",
        content: "在整个回复中保持角色声音和说话模式的一致性。",
        priority: 75,
      },
    ],

    additionalInstructions: [
      {
        id: "inst-respond-to-actions",
        content: "回应玩家最近的行动和对白。确认他们做了什么、说了什么或观察到了什么。",
        priority: 90,
      },
      {
        id: "inst-npc-reactions",
        content: "提供与 NPC 性格、知识和当前情绪状态一致的反应。",
        priority: 85,
      },
      {
        id: "inst-scene-ending",
        content: "在自然的断点结束回复，引导玩家进行下一步行动。",
        priority: 60,
      },
    ],
  },

  outputContract: {
    version: "output-contract-v1",
    mode: "narrative_only",
    slots: [
      {
        id: "narrative",
        required: true,
        order: 10,
        producer: "writer",
      },
    ],
    forbiddenPatterns: ["```json", "<analysis>", "思考过程：", "[Status:", "```yaml"],
    allowExtraText: false,
  },

  retryPolicy: {
    maxWriterRetries: 2,
    maxFormatRepairs: 1,
  },
};
