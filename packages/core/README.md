# @agentbouncr/core

The governance layer for AI agents. Policy Engine, Audit Trail, Kill-Switch, Event System, and Injection Detection.

## Installation

```bash
npm install @agentbouncr/core
```

## Quick Start

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';

const governance = new GovernanceMiddleware();

governance.setPolicy({
  name: 'basic-security',
  version: '1.0',
  rules: [
    {
      tool: 'file_write',
      effect: 'deny',
      condition: { path: { startsWith: '/etc/' } },
      reason: 'Writing to /etc/ is not permitted',
    },
    { tool: '*', effect: 'allow' },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const result = await governance.evaluate({
  agentId: 'my-agent',
  tool: 'file_write',
  params: { path: '/etc/passwd' },
});

console.log(result.allowed); // false
```

For full documentation, examples, and architecture overview, see the [main repository](https://github.com/agentbouncr/agentbouncr).

## License

Elastic License 2.0 (ELv2) — see [LICENSE](./LICENSE)
