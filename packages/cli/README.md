# @agentbouncr/cli

Command-line interface for the [AgentBouncr](https://www.npmjs.com/package/@agentbouncr/core) governance framework. Register agents, manage lifecycle, verify audit trails, and import MCP tool definitions.

## Installation

```bash
npm install -g @agentbouncr/cli
```

Requires Node.js >= 20 and a local SQLite database (created automatically).

## Commands

```
governance agent create --config <file>   Create agent from JSON config
governance agent start <id>               Transition agent to active
governance agent stop <id>                Transition agent to stopped
governance agent list                     List all registered agents
governance agent status <id>              Show agent status (with idle detection)
governance audit verify                   Verify audit trail integrity
governance import --mcp <file>            Import tools from MCP server config
governance stop --all                     Stop all active/idle agents
```

## Agent Lifecycle

Agents follow a state machine with 7 states and validated transitions:

```
registered → active → idle → stopped → decommissioned
                  ↕        ↕
              suspended   error
```

Invalid transitions (e.g. `registered → stopped`) are rejected with a `INVALID_TRANSITION` error.

## Related Packages

- [`@agentbouncr/core`](https://www.npmjs.com/package/@agentbouncr/core) — Policy engine, audit trail, kill-switch, event system
- [`@agentbouncr/sqlite`](https://www.npmjs.com/package/@agentbouncr/sqlite) — SQLite persistence adapter

## License

[Elastic License 2.0](https://www.elastic.co/licensing/elastic-license)
