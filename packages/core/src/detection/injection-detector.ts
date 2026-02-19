/**
 * @agentbouncr/core — Injection Detection
 *
 * Detects prompt injection patterns in incoming messages.
 * IMPORTANT: Injection is NEVER auto-blocked — only logged as warning.
 * Reason: False-positive risk. Blocking decisions are left to the policy layer.
 */

import { securityLogger } from '../utils/logger.js';
import type { InjectionDetectionResult } from '../types/index.js';

export interface InjectionPattern {
  name: string;
  pattern: RegExp;
}

export interface InjectionDetectionOptions {
  /** Pattern names to skip during detection */
  disabledPatterns?: string[];
  /** Optional logger for DI (defaults to securityLogger) */
  logger?: import('pino').Logger;
}

export const DEFAULT_INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: 'ignore_previous_instructions',
    pattern: /ignor(e|ier).*?(previous|vorherige|bisherige|alle).*?(instruction|anweisung|regeln)/i,
  },
  {
    name: 'system_prompt_override',
    pattern: /```system\b/i,
  },
  {
    name: 'admin_mode',
    pattern: /(admin[- ]?mod(e|us)|developer[- ]?mod(e|us)|debug[- ]?mod(e|us))/i,
  },
  {
    name: 'reveal_instructions',
    pattern:
      /(show|reveal|display|zeig|gib).*?(system[- ]?prompt|instruction|api[- ]?key|secret|password|passwort)/i,
  },
  {
    name: 'role_hijack',
    pattern: /(you are now|du bist jetzt|ab jetzt bist du|from now on you are)/i,
  },
  {
    name: 'instruction_delimiter',
    pattern: /(\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>|<\/?system>)/i,
  },
  {
    name: 'execute_command',
    pattern: /(execute_shell|run_command|exec\(|eval\(|child_process)/i,
  },
];

export function detectInjection(
  text: string,
  options?: InjectionDetectionOptions,
): InjectionDetectionResult {
  const log = options?.logger ?? securityLogger;
  const matched: string[] = [];
  const disabled = new Set(options?.disabledPatterns ?? []);

  for (const { name, pattern } of DEFAULT_INJECTION_PATTERNS) {
    if (disabled.has(name)) continue;
    if (pattern.test(text)) {
      matched.push(name);
    }
  }

  const result: InjectionDetectionResult = {
    detected: matched.length > 0,
    patterns: matched,
    text,
  };

  if (result.detected) {
    // Log WARNING only — NEVER block (Fail-Open for injection, event emitted separately)
    log.warn(
      { patterns: matched, event: 'injection_detected' },
      'Injection pattern detected in incoming message',
    );
  }

  return result;
}
