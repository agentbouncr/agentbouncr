# @agentbouncr/sqlite

SQLite persistence adapter for [@agentbouncr/core](https://www.npmjs.com/package/@agentbouncr/core). Uses [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for synchronous, high-performance storage.

## Installation

```bash
npm install @agentbouncr/core @agentbouncr/sqlite
```

## Usage

```typescript
import { GovernanceMiddleware } from '@agentbouncr/core';
import { SqliteDatabaseAdapter } from '@agentbouncr/sqlite';
import pino from 'pino';

const logger = pino({ level: 'info' });
const db = new SqliteDatabaseAdapter(logger, './governance.db');
await db.runMigrations();

const governance = new GovernanceMiddleware({ db, logger });
```

For full documentation, see the [main repository](https://github.com/agentbouncr/agentbouncr).

## License

Elastic License 2.0 (ELv2) — see [LICENSE](./LICENSE)
