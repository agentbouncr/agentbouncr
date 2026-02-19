#!/usr/bin/env node
/**
 * @agentbouncr/cli — CLI Binary Entry Point
 *
 * This file is the bin entry for `governance` command.
 * Separated from index.ts to avoid triggering program.parse() on import.
 *
 * Commands:
 *   governance agent create --config <file>
 *   governance agent start <id>
 *   governance agent stop <id>
 *   governance agent list
 *   governance agent status <id>
 *   governance audit verify
 *   governance import --mcp <file>
 *   governance stop --all
 */

import { Command } from 'commander';
import { VERSION } from './index.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerImportCommands } from './commands/import.js';
import { registerStopCommand } from './commands/stop.js';

const program = new Command();

program
  .name('governance')
  .description('Agent Governance Framework CLI')
  .version(VERSION);

registerAgentCommands(program);
registerAuditCommands(program);
registerImportCommands(program);
registerStopCommand(program);

program.parse();
