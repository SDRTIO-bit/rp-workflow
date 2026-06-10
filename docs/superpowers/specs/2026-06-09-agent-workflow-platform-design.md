# Agent Workflow Platform Design

**Goal:** Build a visual Agent workflow platform where users create, connect, run, inspect, and reuse workflows made from independent nodes, including multiple independently configured Agent nodes.

**Architecture:** The platform is a workflow workbench rather than a fixed RP or writing pipeline. Users define the graph; the system provides node schemas, typed ports, capability isolation, DAG scheduling, runtime logs, and cache-aware Agent execution. The first build targets a local MVP that proves the core model before adding accounts, billing, template markets, or full plugin ecosystems.

**Tech Stack:** Next.js, React, TypeScript, React Flow, Tailwind CSS, ESLint, Prettier, TypeScript compiler, and a later PostgreSQL/ORM layer when persistence moves beyond local/mock storage.

---

## Product Positioning

The product is an Agent Workflow Platform for creative writing, RP, and content automation.

It should feel closer to ComfyUI than to a fixed multi-Agent writing app:

- The platform provides the workbench, runtime, validation, permissions, logs, and reusable node system.
- A workflow is a user-authored graph saved as structured data.
- A node is a capability block.
- An Agent node is one important node type with an LLM core, prompt, visible skills, visible plugins, typed inputs, typed outputs, model settings, and cache strategy.

The platform must not hard-code one correct pipeline such as `StateAgent -> WorldAgent -> MemoryAgent -> WriterAgent -> CriticAgent`. Those can exist as templates, but users decide whether to use them.

## Core Principles

### User-Composed Workflow

Users decide which nodes exist, how they connect, and how data flows. A short workflow that directly outputs prose and a complex workflow with many Agent nodes must both be valid.

### Multi-Agent By Default

Agent is not a singleton. A workflow can contain zero, one, or many Agent nodes.

Each Agent node is an independent instance with its own:

- model
- system prompt
- skills
- plugins/tools
- input ports
- output schema
- runtime settings
- cacheable prompt prefix

Agent nodes do not share abilities by default. Data only crosses from one Agent to another through user-created workflow edges.

### Parallel DAG Execution

The runner executes the workflow as a DAG in the MVP.

A node becomes runnable when all required upstream inputs are available. Multiple runnable nodes can execute in parallel. Downstream nodes wait until their required inputs finish.

Cycles, loops, streaming fan-in, and human approval gates are out of scope for the first build.

### Capability Isolation

Skills and plugins are assigned per Agent node, not globally exposed to the workflow.

If an Agent node has not been granted a skill or plugin, that capability must not appear in its prompt, tool list, or runtime context. This is an architectural boundary, not a prompt instruction.

### Cache-Aware Agent Execution

Because cached token pricing can be much lower than uncached token pricing, Agent prompt assembly should be cache-friendly from the beginning.

The prompt/context builder should place stable content before dynamic content:

Cacheable prefix:

- platform Agent execution protocol
- Agent system prompt
- granted skill content
- granted plugin/tool descriptions
- stable worldbook or character context
- stable workflow/node configuration summary

Dynamic suffix:

- current user input
- current upstream node outputs
- temporary run state
- per-run output instruction

Each Agent node gets its own cacheable prefix hash so multiple Agents can benefit from cache hits without contaminating each other's context.

Runtime logs should preserve enough metadata to optimize later:

- model name
- provider
- cacheable prefix hash
- dynamic input hash
- token usage
- cached token usage when the provider returns it
- latency
- errors

## MVP Scope

The first build should prove the platform abstraction, not the whole ecosystem.

In scope:

- Visual workflow canvas.
- Add, move, configure, and connect nodes.
- Multiple independent Agent nodes.
- DAG-based parallel runner.
- Workflow JSON export/import or local persistence.
- Node run logs.
- Agent skill/plugin permission model.
- Cache-aware prompt assembly.
- Product workflow validation.
- Engineering verification through formatter, typechecker, and linter.

Out of scope for MVP:

- User accounts.
- Billing.
- Team collaboration.
- Template marketplace.
- Full plugin marketplace.
- Complex cyclic workflows.
- Production queue infrastructure.
- Long-term memory UX beyond a minimal typed model.
- Full worldbook database UI.

## First Node Set

The MVP should start with a small set of nodes:

- `UserInputNode`: provides the user's request or seed text.
- `AgentNode`: runs an LLM with node-specific prompt, skills, plugins, and inputs.
- `TextOutputNode`: collects final text for display.
- `DebugLogNode`: exposes intermediate data for inspection.
- `PromptTemplateNode`: combines inputs into a structured prompt fragment.
- `MockSearchNode`: simulates worldbook/database retrieval before real persistence exists.

The first demo workflows should include:

```text
UserInputNode -> AgentNode -> TextOutputNode
```

and:

```text
UserInputNode -> MockSearchNode -> AgentNode -> TextOutputNode
```

A parallel multi-Agent demo should include:

```text
UserInputNode -> AgentNode A
UserInputNode -> AgentNode B
AgentNode A -> AgentNode C
AgentNode B -> AgentNode C
AgentNode C -> TextOutputNode
```

## System Architecture

### `apps/web`

Responsibilities:

- Next.js app shell.
- React Flow canvas.
- Node palette.
- Node configuration panels.
- Run controls.
- Execution log display.
- Local workflow persistence or import/export.

### `packages/workflow-core`

Responsibilities:

- Workflow schema.
- Node schema.
- Port schema.
- Edge schema.
- Data type declarations.
- Workflow validation.
- DAG ordering.
- Parallel execution scheduler.
- Runner interfaces.

### `packages/agent-runtime`

Responsibilities:

- Agent node execution.
- LLM provider adapter interface.
- Mock LLM adapter for local development.
- Skill injection.
- Plugin/tool exposure.
- Cache-aware prompt/context assembly.
- Agent runtime metadata.

### `packages/plugin-sdk`

Responsibilities:

- Plugin definition interface.
- Tool descriptor interface.
- Runtime call contract.
- Permission boundary helpers.

The MVP can ship with mock plugins before real external integrations.

### `packages/db`

Responsibilities:

- Future database schema.
- Workflow persistence model.
- Run persistence model.
- Skill/plugin/worldbook/memory tables.

This package can start as schema documentation or lightweight TypeScript models if the first MVP uses local persistence.

## Workflow Data Model

A workflow is saved as structured JSON:

```json
{
  "id": "workflow_001",
  "name": "Parallel prose workflow",
  "version": 1,
  "nodes": [
    {
      "id": "agent_a",
      "type": "agent",
      "position": { "x": 320, "y": 160 },
      "config": {
        "model": "mock-pro",
        "systemPrompt": "Analyze world context.",
        "skills": ["world_context"],
        "plugins": ["mock_search"],
        "outputType": "analysis"
      }
    }
  ],
  "edges": [
    {
      "id": "edge_001",
      "source": "input_1",
      "sourcePort": "text",
      "target": "agent_a",
      "targetPort": "context"
    }
  ]
}
```

Nodes declare ports:

```ts
type PortDirection = "input" | "output";

type PortDefinition = {
  id: string;
  label: string;
  direction: PortDirection;
  dataType: string;
  required?: boolean;
};
```

The first data types should include:

- `text`
- `user_input`
- `context`
- `search_result`
- `analysis`
- `draft`
- `final_text`
- `debug_info`
- `json`

## Product Validation Pipeline

The product should validate workflows before and during execution.

This is separate from the engineering "triple verification" gate.

Product validation includes:

- Schema validation: workflow, nodes, ports, edges, and config shape.
- Graph validation: missing nodes, missing ports, incompatible edges, and cycles.
- Runtime validation: missing required inputs, failed node runs, and typed output checks.

## Engineering Triple Verification

Every meaningful implementation checkpoint should pass three engineering checks:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
```

The project should expose one command:

```bash
pnpm verify
```

`pnpm verify` should run formatter check, TypeScript compiler, and linter in that order.

Formatter may also have a write mode:

```bash
pnpm format
```

## Error Handling

Workflow validation errors should be explicit and attached to the relevant node, port, or edge.

Runner errors should preserve partial results. If one parallel branch fails, the run should show which node failed and which downstream nodes were blocked.

Agent runtime errors should include provider, model, node id, latency when available, and safe error text.

## Testing Strategy

Unit tests should cover:

- workflow schema validation
- port compatibility
- cycle detection
- DAG ready-node scheduling
- parallel execution behavior
- Agent capability isolation
- cache-aware prompt assembly order

Integration tests should cover:

- simple user input to Agent to output workflow
- parallel Agent fan-out and fan-in workflow
- invalid edge and invalid capability assignment

UI tests can come after the core runner is stable. The first UI verification can be manual plus TypeScript/lint checks.

## Build Order

1. Create project scaffold.
2. Add formatter, TypeScript, linter, and `pnpm verify`.
3. Implement workflow core schemas and validation.
4. Implement DAG scheduling and mock runner.
5. Implement Agent runtime with mock provider and cache-aware prompt builder.
6. Build React Flow canvas with node palette and config panel.
7. Wire UI to runner.
8. Add sample workflows for simple, retrieval, and parallel multi-Agent cases.

## Spec Self-Review

- Placeholder scan: no unfinished marker text remains.
- Consistency check: the architecture consistently treats Agent as a node instance, not as a singleton.
- Scope check: MVP is limited to local visual workflow execution with mockable runtime and does not include marketplace/account/billing features.
- Ambiguity check: "triple verification" is explicitly defined as formatter, TypeScript compiler, and linter; product workflow validation is named separately.
