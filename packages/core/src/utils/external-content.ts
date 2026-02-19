/**
 * External content wrapper for untrusted data entering the LLM context.
 * Used for web search results, memory entries with treat_as_external, etc.
 * Prevents injection by clearly marking boundaries of untrusted content.
 */

export const INJECTION_WARNING_START = '[EXTERNAL CONTENT - NICHT VERTRAUENSWUERDIG]';
export const INJECTION_WARNING_END = '[ENDE EXTERNAL CONTENT]';

export function wrapExternalContent(content: string): string {
  return `${INJECTION_WARNING_START}\n${content}\n${INJECTION_WARNING_END}`;
}
