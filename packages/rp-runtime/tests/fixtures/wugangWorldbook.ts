/**
 * 雾港残灯 Worldbook Data - Phase B-2.7
 *
 * A complex Chinese worldbook for testing multi-category activation.
 * Setting: 黑潮纪元, 雾港城
 * Main character: 苏绫
 * Player identity: 失忆的巡夜人
 */

import type { WorldbookEntryV1 } from "./types.js";

/**
 * 35 worldbook entries covering:
 * - 4 characters (苏绫, 沈砚, 叶烛, 银铃)
 * - 3 relationships
 * - 4 historical events
 * - 3 locations
 * - 3 factions
 * - 3 key items
 * - 5 world rules
 * - 4 hidden secrets
 * - 3 format instructions
 * - 6 constant rules
 */
export const WUGANG_WORLDBOOK: WorldbookEntryV1[] = [
  // ============================================================
  // CONSTANT RULES (6 entries)
  // ============================================================
  {
    id: "rule_narrative_style",
    title: "叙事风格规则",
    content:
      "保持第三人称限制视角，以玩家角色为视角中心。不输出状态栏、JSON、分析或元评论。只输出角色扮演可见内容。",
    keys: [],
    category: "constant",
    priority: 100,
    visibility: "public",
    constant: true,
  },
  {
    id: "rule_no_player_control",
    title: "不替玩家决定",
    content: "不替玩家决定新的行动、对白或心理。只有玩家能控制自己的角色。保持角色的认知边界。",
    keys: [],
    category: "constant",
    priority: 100,
    visibility: "public",
    constant: true,
  },
  {
    id: "rule_no_leak_secrets",
    title: "不泄露隐藏信息",
    content:
      "不以旁白说明方式直接泄露隐藏世界书或 Runtime 内部信息。秘密可以影响角色行为，但不能直接陈述。",
    keys: [],
    category: "constant",
    priority: 100,
    visibility: "public",
    constant: true,
  },
  {
    id: "rule_continuity",
    title: "场景连续性",
    content: "保持地点、时间、人物和动作的连续性。不要瞬移角色或跳过逻辑后果。",
    keys: [],
    category: "constant",
    priority: 100,
    visibility: "public",
    constant: true,
  },
  {
    id: "rule_sensory_detail",
    title: "感官细节",
    content:
      "包含视觉、听觉、嗅觉、触觉等感官细节来增强场景沉浸感。通过动作、肢体语言和对白展示情感。",
    keys: [],
    category: "constant",
    priority: 90,
    visibility: "public",
    constant: true,
  },
  {
    id: "rule_nsfw_boundaries",
    title: "NSFW 边界规则",
    content:
      "不描写性行为细节。可以暗示亲密关系和浪漫张力，但不进入explicit描写。暴力描写保持在叙事必要范围内。",
    keys: [],
    category: "nsfw_rule",
    priority: 100,
    visibility: "public",
    constant: true,
  },

  // ============================================================
  // CHARACTERS (4 entries)
  // ============================================================
  {
    id: "char_su_ling",
    title: "苏绫",
    content:
      "苏绫是雾港城的铃医，外表冷静沉着，很少直接承认恐惧。她习惯隐藏自己的不安，用冷漠作为保护色。她的左手腕上有一道旧伤疤，是三年前钟楼火灾留下的。她知道银铃真正的启动方式，但从未对任何人说过。她对玩家怀有强烈的亏欠感，因为三年前玩家曾在钟楼火灾中救过她，但玩家自己已经失去了这部分记忆。",
    keys: ["苏绫", "铃医"],
    aliases: ["阿绫", "小绫", "苏姑娘"],
    category: "character",
    priority: 95,
    depth: 1,
    relatedEntryIds: [
      "rel_player_su_ling",
      "rel_su_ling_shen_yan",
      "item_silver_bell",
      "event_clocktower_fire",
    ],
    visibility: "public",
  },
  {
    id: "char_shen_yan",
    title: "沈砚",
    content:
      "沈砚曾是巡夜司的副指挥，三年前参与了钟楼火灾的调查。他携带过与银铃相似的白塔器物。玩家记忆中，沈砚曾是可信赖的同伴，但三年前的事件后关系变得复杂。沈砚当前不在现场，不得让他突然出现。",
    keys: ["沈砚"],
    aliases: ["沈副指挥", "沈大人"],
    category: "character",
    priority: 85,
    depth: 2,
    relatedEntryIds: ["rel_su_ling_shen_yan", "event_clocktower_fire", "faction_night_watch"],
    visibility: "public",
  },
  {
    id: "char_ye_zhu",
    title: "叶烛",
    content:
      "叶烛是白塔教会的低阶祭司，表面温和，实际在执行教会的秘密任务。他知道银铃的存在，但不知道苏绫的真实身份。他在教会内部地位不高，但野心勃勃。",
    keys: ["叶烛"],
    aliases: ["叶祭司", "小叶"],
    category: "character",
    priority: 70,
    depth: 3,
    relatedEntryIds: ["faction_white_tower", "event_missing_list"],
    visibility: "public",
  },
  {
    id: "char_yin_ling",
    title: "银铃（角色）",
    content:
      "银铃是白塔教会的圣物，表面是一枚精致的银质铃铛，内藏黑潮纪元的古老力量。三年前钟楼火灾时，银铃曾被激活过一次。苏绫知道它的真正用途，但选择隐瞒。",
    keys: ["圣铃"],
    aliases: ["白塔银铃", "银质铃铛"],
    category: "character",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["item_silver_bell", "secret_silver_bell_use", "faction_white_tower"],
    visibility: "public",
  },

  // ============================================================
  // RELATIONSHIPS (3 entries)
  // ============================================================
  {
    id: "rel_player_su_ling",
    title: "玩家与苏绫的关系",
    content:
      "三年前，玩家曾在钟楼火灾中救过苏绫。苏绫对此怀有强烈的亏欠感，但玩家已经失去了这部分记忆。苏绫表现得与玩家并不熟悉，但当玩家主动承担危险时，她会表现出明显抗拒，却不会直接说明原因。",
    keys: ["苏绫", "阿绫", "旧约"],
    secondaryKeys: ["玩家", "巡夜人", "钟楼"],
    selective: true,
    category: "relationship",
    priority: 90,
    depth: 1,
    relatedEntryIds: ["char_su_ling", "event_clocktower_fire", "secret_player_amnesia"],
    visibility: "public",
  },
  {
    id: "rel_su_ling_shen_yan",
    title: "苏绫与沈砚的历史关系",
    content:
      "苏绫和沈砚曾是调查伙伴。三年前钟楼火灾后，苏绫发现沈砚携带了白塔教会的器物，开始怀疑他的忠诚。沈砚对苏绫有愧疚感，但两人已经不再信任彼此。",
    keys: ["苏绫", "沈砚"],
    secondaryKeys: ["关系", "伙伴"],
    selective: true,
    category: "relationship",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["char_su_ling", "char_shen_yan", "event_clocktower_fire"],
    visibility: "public",
  },
  {
    id: "rel_ye_zhu_church",
    title: "叶烛与教会的关系",
    content:
      "叶烛是白塔教会的低阶祭司，执行教会的秘密任务。他在教会内部地位不高，但野心勃勃。他不知道苏绫的真实身份，只知道银铃的存在。",
    keys: ["叶烛", "教会"],
    category: "relationship",
    priority: 60,
    depth: 3,
    relatedEntryIds: ["char_ye_zhu", "faction_white_tower"],
    visibility: "public",
  },

  // ============================================================
  // HISTORICAL EVENTS (4 entries)
  // ============================================================
  {
    id: "event_clocktower_fire",
    title: "三年前的钟楼火灾",
    content:
      "三年前，雾港城旧钟楼发生大火，导致巡夜司档案大量遗失，也是玩家记忆断裂的起点之一。苏绫对此事知道得比她公开承认的更多。火灾中银铃曾被意外激活，释放了黑潮力量。",
    keys: ["钟楼", "火灾", "三年前"],
    aliases: ["钟楼大火", "旧钟楼火灾"],
    category: "event",
    priority: 90,
    depth: 1,
    relatedEntryIds: ["char_su_ling", "char_shen_yan", "item_silver_bell", "location_clocktower"],
    excludesEntryIds: ["secret_clocktower_truth"],
    visibility: "public",
  },
  {
    id: "event_missing_list",
    title: "失踪名单",
    content:
      "雾港城近期有多人失踪，巡夜司正在调查。失踪名单是玩家手中掌握的关键证据之一。失踪事件可能与黑潮感染有关。",
    keys: ["失踪", "名单"],
    aliases: ["失踪人口", "失踪事件"],
    category: "event",
    priority: 75,
    depth: 2,
    relatedEntryIds: ["faction_night_watch", "rule_black_tide_infection"],
    visibility: "public",
  },
  {
    id: "event_ye_shi_zhi_ye",
    title: "月蚀之夜",
    content:
      "每月一次的月蚀之夜，黑潮力量会增强。教会会在月蚀之夜举行秘密仪式。银铃在月蚀之夜有特殊反应。",
    keys: ["月蚀", "月蚀之夜"],
    category: "event",
    priority: 65,
    depth: 3,
    relatedEntryIds: ["item_silver_bell", "faction_white_tower"],
    visibility: "hidden",
  },
  {
    id: "event_player_amnesia",
    title: "玩家失忆事件",
    content:
      "玩家在三年前钟楼火灾中失去了部分记忆，包括与苏绫的过往。失忆的原因与银铃的黑潮力量有关。",
    keys: ["失忆", "记忆"],
    aliases: ["记忆丧失", "记忆断裂"],
    category: "event",
    priority: 85,
    depth: 1,
    relatedEntryIds: ["secret_player_amnesia", "event_clocktower_fire"],
    visibility: "hidden",
  },

  // ============================================================
  // LOCATIONS (3 entries)
  // ============================================================
  {
    id: "location_clocktower",
    title: "旧钟楼",
    content:
      "雾港城旧钟楼区的标志性建筑，三年前大火后废弃。钟楼二层是玩家与苏绫的藏身之处。钟楼通向地下水道的暗门仍在使用。",
    keys: ["钟楼", "旧钟楼", "旧钟楼区"],
    aliases: ["钟楼区", "旧钟楼二层"],
    category: "location",
    priority: 85,
    depth: 1,
    relatedEntryIds: ["event_clocktower_fire", "location_sewer"],
    visibility: "public",
  },
  {
    id: "location_sewer",
    title: "地下水道",
    content:
      "雾港城地下的古老水道系统，可以通向旧港区。苏绫知道这些水道的路线。巡夜司很少巡查水道，是安全的撤离路线。",
    keys: ["地下水道", "水道"],
    aliases: ["下水道", "地下通道"],
    category: "location",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["location_clocktower"],
    visibility: "public",
  },
  {
    id: "location_wugang_city",
    title: "雾港城",
    content:
      "黑潮纪元的沿海城市，常年被海雾笼罩。城市分为旧钟楼区、码头区、教会区和贫民窟。巡夜司总部位于教会区。",
    keys: ["雾港", "雾港城"],
    aliases: ["雾港"],
    category: "location",
    priority: 70,
    depth: 2,
    relatedEntryIds: ["faction_night_watch", "faction_white_tower"],
    visibility: "public",
  },

  // ============================================================
  // FACTIONS (3 entries)
  // ============================================================
  {
    id: "faction_night_watch",
    title: "巡夜司",
    content:
      "雾港城的官方治安组织，负责夜间巡逻和黑潮感染者的追捕。巡夜司对失踪事件高度关注。他们的敲门声意味着调查或逮捕。",
    keys: ["巡夜司", "巡夜"],
    aliases: ["夜巡", "夜间巡逻队"],
    category: "faction",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["char_shen_yan", "event_missing_list"],
    visibility: "public",
  },
  {
    id: "faction_white_tower",
    title: "白塔教会",
    content:
      "雾港城的宗教组织，崇拜白塔之光。教会在城市中有广泛影响力，但内部派系斗争激烈。教会持有银铃等古代圣物，对黑潮有独特的理解。",
    keys: ["白塔教会", "教会", "白塔"],
    aliases: ["白塔", "教会"],
    category: "faction",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["char_ye_zhu", "item_silver_bell"],
    visibility: "public",
  },
  {
    id: "faction_ya_du",
    title: "鸦渡会",
    content:
      "雾港城地下的走私组织，控制着旧港区的非法交易。他们对教会和巡夜司都有仇怨。玩家如果需要黑市情报，可能需要找他们。",
    keys: ["鸦渡会", "鸦渡"],
    aliases: ["走私者", "黑市"],
    category: "faction",
    priority: 60,
    depth: 3,
    relatedEntryIds: [],
    visibility: "public",
  },

  // ============================================================
  // ITEMS (3 entries)
  // ============================================================
  {
    id: "item_silver_bell",
    title: "银铃",
    content:
      "白塔教会的圣物，一枚精致的银质铃铛。铃身上刻有被火烧过的白塔纹章。三年前钟楼火灾时曾被意外激活。苏绫知道它的真正启动方式，但从未对任何人说过。银铃在月蚀之夜有特殊反应。",
    keys: ["银铃", "圣铃"],
    aliases: ["白塔银铃", "银质铃铛"],
    category: "item",
    priority: 85,
    depth: 1,
    relatedEntryIds: [
      "char_su_ling",
      "char_yin_ling",
      "faction_white_tower",
      "event_ye_shi_zhi_ye",
    ],
    visibility: "public",
  },
  {
    id: "item_missing_list",
    title: "失踪名单",
    content:
      "玩家手中掌握的失踪人员名单，记录了雾港城近期所有失踪者的信息。这份名单是调查的关键线索，也是巡夜司想要获取的证据。",
    keys: ["失踪名单", "名单"],
    aliases: ["失踪人口名单"],
    category: "item",
    priority: 75,
    depth: 2,
    relatedEntryIds: ["event_missing_list", "faction_night_watch"],
    visibility: "public",
  },
  {
    id: "item_clocktower_key",
    title: "钟楼钥匙",
    content:
      "苏绫保管的旧钟楼钥匙，可以打开钟楼二层的房间和通向地下水道的暗门。钥匙是黄铜制的，把手处有烧痕。",
    keys: ["钟楼钥匙", "钥匙"],
    aliases: ["黄铜钥匙"],
    category: "item",
    priority: 70,
    depth: 2,
    relatedEntryIds: ["location_clocktower", "location_sewer", "char_su_ling"],
    visibility: "public",
  },

  // ============================================================
  // WORLD RULES (5 entries)
  // ============================================================
  {
    id: "rule_black_tide",
    title: "黑潮纪元",
    content:
      "当前时代被称为黑潮纪元。黑潮是一种周期性增强的神秘力量，会感染生物并使其异变。月蚀之夜黑潮力量最强。教会认为黑潮是神圣的试炼。",
    keys: ["黑潮", "黑潮纪元"],
    category: "world_rule",
    priority: 90,
    depth: 1,
    relatedEntryIds: ["event_ye_shi_zhi_ye", "rule_black_tide_infection"],
    visibility: "public",
  },
  {
    id: "rule_black_tide_infection",
    title: "黑潮感染",
    content:
      "黑潮感染者的皮肤会出现黑色纹路，行为变得狂暴。感染初期可以通过教会的净化仪式治愈。晚期感染无法逆转。巡夜司有权处决感染者。",
    keys: ["黑潮感染", "感染者"],
    aliases: ["感染", "黑潮纹"],
    category: "world_rule",
    priority: 85,
    depth: 2,
    relatedEntryIds: ["rule_black_tide", "faction_night_watch"],
    visibility: "public",
  },
  {
    id: "rule_magic_system",
    title: "魔法与力量体系",
    content:
      "这个世界的力量来源于古代白塔遗迹。银铃是白塔圣物之一，可以引导黑潮力量。普通人类无法直接使用黑潮力量，但可以通过圣物间接操控。",
    keys: ["魔法", "力量", "白塔遗迹"],
    category: "world_rule",
    priority: 75,
    depth: 2,
    relatedEntryIds: ["item_silver_bell", "faction_white_tower"],
    visibility: "public",
  },
  {
    id: "rule_player_identity",
    title: "玩家身份规则",
    content:
      "玩家是失忆的巡夜人，三年前在钟楼火灾中失去了部分记忆。玩家不知道自己曾与苏绫有过深厚的关系。玩家可以自由行动和对话。",
    keys: ["巡夜人", "失忆"],
    category: "world_rule",
    priority: 80,
    depth: 1,
    relatedEntryIds: ["event_player_amnesia", "rel_player_su_ling"],
    visibility: "public",
  },
  {
    id: "rule_output_format",
    title: "输出格式规则",
    content: "只输出角色扮演正文。不输出JSON、分析、状态栏或元评论。保持场景连续性和角色认知边界。",
    keys: [],
    category: "format_instruction",
    priority: 95,
    visibility: "public",
    constant: true,
  },

  // ============================================================
  // HIDDEN SECRETS (4 entries)
  // ============================================================
  {
    id: "secret_su_ling_identity",
    title: "苏绫的真实身份",
    content:
      "苏绫是白塔教会的圣女血脉后裔，拥有操控黑潮力量的天赋。她隐藏身份是为了保护自己和玩家。她知道银铃真正的启动方式。",
    keys: ["银铃", "黑潮", "圣女血脉"],
    secondaryKeys: ["苏绫", "阿绫"],
    selective: true,
    category: "secret",
    priority: 90,
    depth: 1,
    relatedEntryIds: ["char_su_ling", "item_silver_bell", "rule_magic_system"],
    visibility: "hidden",
  },
  {
    id: "secret_clocktower_truth",
    title: "钟楼火灾真相",
    content:
      "三年前的钟楼火灾并非意外，而是白塔教会的秘密仪式引发的。沈砚参与了仪式，这也是他携带白塔器物的原因。苏绫知道真相但选择隐瞒。",
    keys: ["钟楼火灾", "真相"],
    secondaryKeys: ["教会", "沈砚"],
    selective: true,
    category: "secret",
    priority: 85,
    depth: 2,
    relatedEntryIds: ["event_clocktower_fire", "char_shen_yan", "faction_white_tower"],
    excludesEntryIds: ["event_clocktower_fire"],
    visibility: "hidden",
  },
  {
    id: "secret_shen_yan_betrayal",
    title: "沈砚背叛事件",
    content:
      "沈砚在三年前背叛了玩家和苏绫，将钟楼的位置泄露给了白塔教会。他的背叛导致了钟楼火灾。沈砚对此深感愧疚，但无法挽回。",
    keys: ["沈砚", "背叛"],
    secondaryKeys: ["钟楼", "三年前"],
    selective: true,
    category: "secret",
    priority: 80,
    depth: 2,
    relatedEntryIds: ["char_shen_yan", "event_clocktower_fire", "rel_su_ling_shen_yan"],
    visibility: "hidden",
  },
  {
    id: "secret_silver_bell_use",
    title: "银铃的真正用途",
    content:
      "银铃可以打开通往白塔遗迹的通道，但需要圣女血脉的激活。苏绫知道这一点，但从未告诉任何人。银铃在月蚀之夜会自行振动。",
    keys: ["银铃", "用途", "启动"],
    secondaryKeys: ["苏绫", "白塔"],
    selective: true,
    category: "secret",
    priority: 85,
    depth: 2,
    relatedEntryIds: ["item_silver_bell", "char_su_ling", "event_ye_shi_zhi_ye"],
    visibility: "hidden",
  },

  // ============================================================
  // FORMAT INSTRUCTIONS (3 entries)
  // ============================================================
  {
    id: "format_dialogue",
    title: "对白格式",
    content: "角色对白使用中文引号「」包裹。对白前标注说话者姓名。语气词和感叹词保持自然。",
    keys: [],
    category: "format_instruction",
    priority: 70,
    visibility: "public",
    constant: true,
  },
  {
    id: "format_action",
    title: "动作描写格式",
    content:
      "角色动作使用动词开头的短句描写。避免使用「他想」「她觉得」等直接心理描写，通过动作和对白间接表达。",
    keys: [],
    category: "format_instruction",
    priority: 70,
    visibility: "public",
    constant: true,
  },
  {
    id: "format_scene_break",
    title: "场景切换格式",
    content: "场景切换使用空行分隔，不使用「---」或其他分隔符。时间流逝通过描写暗示，不直接说明。",
    keys: [],
    category: "format_instruction",
    priority: 65,
    visibility: "public",
    constant: true,
  },
];
