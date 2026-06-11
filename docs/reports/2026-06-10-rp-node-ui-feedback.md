# RP Node UI Feedback and Rework Requirements

Date: 2026-06-10

Based on the current RP canvas screenshots, the workflow can already connect the main RP nodes, but the canvas readability and node editing experience still need a focused rework.

## 1. Mixed Chinese and English text overlaps inside nodes

- Issue: Node cards display Chinese and English at the same time. Port labels, node descriptions, and field labels crowd into each other and overlap.
- Requirement: For the current iteration, use English consistently across node cards.
- Acceptance: Node titles, types, ports, descriptions, and edge labels do not overlap. Each node card uses one display language only.

## 2. The final text output node is unclear

- Issue: `rp_output` is labelled as final prose output, but users cannot tell who receives it, where they can read it, or whether it is a preview, export, or final user-facing reply.
- Requirement: Make the output destination and reading surface explicit, for example `Final Reply`, `Preview`, `Export`, or `Send to User`.
- Acceptance: From the node itself, users can understand what the output is, who it is for, and where it can be viewed.

## 3. Preview node should accept any data line

- Issue: There is no universal way to inspect arbitrary workflow data during editing.
- Requirement: Add or strengthen a generic `Preview` node that can connect to any output type and preview any data.
- Acceptance: The preview node can connect to `text`, `json`, `context`, `draft`, `scene_state`, `character_profile`, `memory`, and other data outputs. It should render plain text, structured JSON, or a concise structured summary based on the incoming data type.

## 4. Agent nodes do not look distinctive

- Issue: `rp_director` and other agent nodes do not visually communicate that they are agents. They look too similar to normal data-processing nodes.
- Requirement: Agent nodes need their own visual treatment and information hierarchy, such as a clear Agent marker, model/skill/tool summary, input intent, and output behavior.
- Acceptance: Users can identify agent nodes and understand each agent's core responsibility without opening the configuration panel.

## 5. Node configuration should open in the canvas center

- Issue: Clicking a node opens a shared configuration panel on the right side, far from the user's focus on the selected node.
- Requirement: Clicking a node should open that node's configuration in a centered modal or floating panel.
- Acceptance: The configuration appears in the center of the canvas, shows the selected node's own settings, and can be closed to return to the workflow.

## 6. All node configuration panels look the same

- Issue: Worldbook, Agent, history/memory, output, and preview nodes all use nearly the same configuration layout, so the panel does not reflect each node's purpose.
- Requirement: Different node types need purpose-built configuration panels instead of one shared generic template.
- Acceptance:
  - Worldbook nodes emphasize lookup scope, match rules, entry source, and test query.
  - Agent nodes emphasize goal, skills, plugins/tools, reply rules, and model behavior.
  - History/memory nodes emphasize read/write mode, memory type, priority, tags, and long-term memory operations.
  - Output/preview nodes emphasize display mode, target user, final text, or debug data.

## Suggested Priority

1. Fix node card language and text overlap first so the canvas is readable.
2. Add the universal `Preview` node so users can inspect any data flow.
3. Replace the right-side shared panel with a centered node configuration modal.
4. Build differentiated configuration panels for Agent, Worldbook, Memory, Output, and Preview nodes.
