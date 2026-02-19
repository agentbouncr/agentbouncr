/**
 * @agentbouncr/core — Agent Governance Framework
 *
 * The governance layer for AI agents.
 * The agent does not decide what it may do — the system decides.
 */

export const VERSION = '0.1.0';

// Types
export {
  GovernanceError,
  type FailureCategory,
  type InjectionDetectionResult,
  type KillSwitchResult,
  type PermissionResult,
  type EvaluateRequest,
  type EvaluateResult,
  type AppliedRule,
  type ToolResult,
  type ToolExecutionContext,
  type AuditEvent,
  type AuditEventInput,
  type AuditFilter,
  type AuditChainVerificationResult,
  type ConditionOperator,
  type PolicyCondition,
  type Policy,
  type PolicyRule,
  type PolicyVersion,
  type AgentRunStatus,
  type AgentConfig,
  type AgentStatus,
  type TransactionClient,
  type DatabaseAdapter,
  type ToolFilter,
  type GovernanceEventRecord,
  type GovernanceEventFilter,
  type ApprovalStatus,
  type ApprovalRequest,
  type ApprovalRequestInput,
  type ApprovalFilter,
  type ApprovalResolution,
} from './types/index.js';

// Canonical Tool Schema
export {
  governanceToolSchema,
  governanceToolParameterSchema,
  toolParameterConstraintsSchema,
  riskLevelSchema,
  toolSourceSchema,
  parametersToJsonSchema,
  type GovernanceTool,
  type GovernanceToolParameter,
  type ToolParameterConstraints,
  type RiskLevel,
  type ToolSource,
} from './schema/tool-schema.js';

// Logger
export { logger, securityLogger } from './utils/logger.js';

// External Content
export {
  wrapExternalContent,
  INJECTION_WARNING_START,
  INJECTION_WARNING_END,
} from './utils/external-content.js';

// Event System
export {
  GovernanceEventEmitter,
  type GovernanceEventType,
  type GovernanceEvent,
  type GovernanceEventListener,
} from './events/event-emitter.js';

// Injection Detection
export {
  detectInjection,
  DEFAULT_INJECTION_PATTERNS,
  type InjectionDetectionOptions,
  type InjectionPattern,
} from './detection/injection-detector.js';

// Permission Layer
export { PermissionLayer } from './core/permission-layer.js';

// Condition Evaluator
export { evaluateCondition } from './core/condition-evaluator.js';

// Policy Engine
export { PolicyEngine } from './core/policy-engine.js';

// Policy Schema
export {
  policySchema,
  policyRuleSchema,
  policyConditionSchema,
  validatePolicy,
} from './core/policy-schema.js';

// Tool Registry
export {
  ToolRegistry,
  type ProviderToolDefinition,
} from './core/tool-registry.js';

// Importers
export { jsonSchemaToParameters } from './importers/json-schema-converter.js';
export {
  importMCPTools,
  type MCPToolDefinition,
  type MCPImportOptions,
} from './importers/mcp-importer.js';

// Provider Adapter
export {
  wrapToolsWithGovernance,
  type AITool,
  type AIToolSet,
  type GovernanceWrapOptions,
} from './providers/vercel-ai-adapter.js';

// Lifecycle
export {
  GovernanceMiddleware,
  type GovernanceMiddlewareOptions,
} from './lifecycle/governance-middleware.js';

export {
  KillSwitchManager,
  type KillSwitchStatus,
} from './lifecycle/kill-switch.js';

export {
  evaluateRequestSchema,
  agentConfigSchema,
  dryRunRequestSchema,
} from './lifecycle/middleware-schemas.js';

// Tracing (W3C Trace Context)
export {
  TraceProvider,
  createTraceContext,
  generateTraceId,
  generateSpanId,
  isValidTraceId,
  isValidSpanId,
  parseTraceparent,
  type TraceContext,
} from './tracing/index.js';

// Audit Trail (Hash-Chain)
export {
  computeAuditHash,
  verifyAuditEventHash,
  type HashInput,
} from './audit/index.js';
