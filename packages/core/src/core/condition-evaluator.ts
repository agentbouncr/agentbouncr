/**
 * @agentbouncr/core — Condition Evaluator
 *
 * Pure function. Evaluates a PolicyCondition against tool call params.
 * 11 operators, deterministic, no external dependencies.
 *
 * Returns true if ALL conditions match (AND-logic across param keys,
 * AND-logic across operators within a single param).
 *
 * Fail-Secure: missing param = false, type mismatch = false,
 * unknown operator = false, invalid regex = false.
 */

import safe from 'safe-regex2';
import type { PolicyCondition, ConditionOperator } from '../types/index.js';

/**
 * Evaluate a condition against the provided params.
 * Returns true if condition is undefined/empty (no condition = always matches).
 * Returns false if a referenced param is missing from params (fail-secure).
 */
export function evaluateCondition(
  condition: PolicyCondition | undefined,
  params: Record<string, unknown> | undefined,
): boolean {
  if (!condition || Object.keys(condition).length === 0) {
    return true;
  }

  if (!params) {
    return false;
  }

  for (const [paramName, operators] of Object.entries(condition)) {
    const paramValue = params[paramName];

    for (const [op, operand] of Object.entries(operators) as [ConditionOperator, unknown][]) {
      if (!evaluateOperator(op, paramValue, operand)) {
        return false;
      }
    }
  }

  return true;
}

function evaluateOperator(
  operator: ConditionOperator,
  paramValue: unknown,
  operand: unknown,
): boolean {
  switch (operator) {
    case 'equals':
      return paramValue === operand;

    case 'notEquals':
      if (paramValue === undefined) return false;
      return paramValue !== operand;

    case 'startsWith':
      return typeof paramValue === 'string' && typeof operand === 'string'
        && paramValue.startsWith(operand);

    case 'endsWith':
      return typeof paramValue === 'string' && typeof operand === 'string'
        && paramValue.endsWith(operand);

    case 'contains':
      return typeof paramValue === 'string' && typeof operand === 'string'
        && paramValue.includes(operand);

    case 'gt':
      return typeof paramValue === 'number' && typeof operand === 'number'
        && paramValue > operand;

    case 'lt':
      return typeof paramValue === 'number' && typeof operand === 'number'
        && paramValue < operand;

    case 'gte':
      return typeof paramValue === 'number' && typeof operand === 'number'
        && paramValue >= operand;

    case 'lte':
      return typeof paramValue === 'number' && typeof operand === 'number'
        && paramValue <= operand;

    case 'in':
      return Array.isArray(operand) && (operand as unknown[]).includes(paramValue);

    case 'matches': {
      if (typeof paramValue !== 'string' || typeof operand !== 'string') return false;
      if (operand.length > 200) return false;
      if (!safe(operand)) return false; // ReDoS protection: reject catastrophic backtracking patterns
      try {
        return new RegExp(operand).test(paramValue);
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}
