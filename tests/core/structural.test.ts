/**
 * Structural Tests — verify security properties via source code analysis.
 *
 * These tests read source code and check hard rules:
 * - Import isolation: Core imports NOTHING from /ee
 * - No singleton patterns
 * - No eval/exec/shell execution
 * - No console.log (Pino only)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';

const projectRoot = process.cwd();

function readCoreSourceFiles(): { path: string; content: string }[] {
  const files = globSync('packages/core/src/**/*.ts', { cwd: projectRoot });
  return files.map((f) => ({
    path: f,
    content: readFileSync(join(projectRoot, f), 'utf-8'),
  }));
}

describe('Structural Tests', () => {
  const sourceFiles = readCoreSourceFiles();

  describe('import isolation — core NEVER imports from /ee', () => {
    it('should not have any import from ee/ in packages/core/src/', () => {
      for (const { path, content } of sourceFiles) {
        expect(content, `${path} imports from ee/`).not.toMatch(/from\s+['"].*ee\//);
        expect(content, `${path} requires from ee/`).not.toMatch(/require\s*\(\s*['"].*ee\//);
      }
    });
  });

  describe('no singleton patterns', () => {
    it('should not export singleton instances via export default new', () => {
      for (const { path, content } of sourceFiles) {
        expect(content, `${path} exports singleton via default new`).not.toMatch(
          /export\s+default\s+new\s+/,
        );
      }
    });

    it('should not export singleton instances via export const = new (domain objects)', () => {
      for (const { path, content } of sourceFiles) {
        // Skip logger.ts — Pino instances are acceptable module-level exports
        if (path.includes('logger.ts')) continue;

        const singletonExport = content.match(/export\s+const\s+\w+\s*=\s*new\s+(\w+)/);
        expect(singletonExport, `${path} exports singleton: ${singletonExport?.[0]}`).toBeNull();
      }
    });
  });

  describe('no eval/exec/shell execution', () => {
    it('should not contain eval(), exec(), or shell execution', () => {
      for (const { path, content } of sourceFiles) {
        // Match actual code usage, not string literals in regex patterns
        const lines = content.split('\n');
        for (const [i, line] of lines.entries()) {
          // Skip regex patterns (they detect injection, not execute it)
          if (line.includes('pattern:') || line.includes('RegExp')) continue;
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

          expect(line, `${path}:${i + 1} contains eval()`).not.toMatch(/\beval\s*\(/);
          expect(line, `${path}:${i + 1} contains exec()`).not.toMatch(/\bexec\s*\(/);
          expect(line, `${path}:${i + 1} contains sh -c`).not.toMatch(/\bsh\s+-c\b/);
        }
      }
    });
  });

  describe('no console.log — Pino only', () => {
    it('should not use console.log/warn/error in core source', () => {
      for (const { path, content } of sourceFiles) {
        expect(content, `${path} uses console.log`).not.toMatch(/console\.(log|warn|error)\s*\(/);
      }
    });
  });

  describe('permission layer — every code path returns allowed field', () => {
    it('should have allowed field in every return statement', () => {
      const plFile = sourceFiles.find((f) => f.path.includes('permission-layer.ts'));
      expect(plFile).toBeDefined();
      if (!plFile) return;

      const returnStatements = plFile.content.match(/return\s*\{[^}]*\}/g) ?? [];
      expect(returnStatements.length).toBeGreaterThan(0);

      for (const ret of returnStatements) {
        expect(ret, `Return statement missing allowed: ${ret}`).toContain('allowed');
      }
    });
  });

  describe('policy engine — every code path returns allowed field', () => {
    it('should have allowed field in every return statement of evaluate()', () => {
      const peFile = sourceFiles.find((f) => f.path.includes('policy-engine.ts'));
      expect(peFile).toBeDefined();
      if (!peFile) return;

      const returnStatements = peFile.content.match(/return\s*\{[^}]*\}/g) ?? [];
      expect(returnStatements.length).toBeGreaterThan(0);

      for (const ret of returnStatements) {
        expect(ret, `Return statement missing allowed: ${ret}`).toContain('allowed');
      }
    });

    it('should capture all return-object statements (meta-check)', () => {
      const peFile = sourceFiles.find((f) => f.path.includes('policy-engine.ts'));
      if (!peFile) return;

      const returnCount = (peFile.content.match(/return\s*\{/g) ?? []).length;
      const capturedCount = (peFile.content.match(/return\s*\{[^}]*\}/g) ?? []).length;
      expect(capturedCount, 'Regex must capture all return statements (no nested braces)').toBe(returnCount);
    });
  });

  describe('policy engine — no LLM or provider imports', () => {
    it('should not import from providers/ or any AI SDK', () => {
      const peFile = sourceFiles.find((f) => f.path.includes('policy-engine.ts'));
      expect(peFile).toBeDefined();
      if (!peFile) return;

      expect(peFile.content).not.toMatch(/from\s+['"].*providers\//);
      expect(peFile.content).not.toMatch(/from\s+['"].*@ai-sdk/);
      expect(peFile.content).not.toMatch(/from\s+['"].*openai/);
      expect(peFile.content).not.toMatch(/from\s+['"].*anthropic/);
    });
  });

  describe('vercel-ai-adapter — no ai package import', () => {
    it('should not import from the ai package', () => {
      const adapterFile = sourceFiles.find((f) => f.path.includes('vercel-ai-adapter.ts'));
      expect(adapterFile).toBeDefined();
      if (!adapterFile) return;

      expect(adapterFile.content, 'vercel-ai-adapter.ts imports from ai package')
        .not.toMatch(/from\s+['"]ai['"]/);
      expect(adapterFile.content, 'vercel-ai-adapter.ts imports from @ai-sdk')
        .not.toMatch(/from\s+['"]@ai-sdk/);
    });
  });

  describe('importers — no ee imports', () => {
    it('should not import from /ee in any importer file', () => {
      const importerFiles = sourceFiles.filter((f) => /[/\\]importers[/\\]/.test(f.path));
      expect(importerFiles.length).toBeGreaterThan(0);

      for (const { path, content } of importerFiles) {
        expect(content, `${path} imports from ee/`).not.toMatch(/from\s+['"].*ee\//);
      }
    });
  });

  describe('providers — no ee imports', () => {
    it('should not import from /ee in any provider file', () => {
      const providerFiles = sourceFiles.filter((f) => /[/\\]providers[/\\]/.test(f.path));
      expect(providerFiles.length).toBeGreaterThan(0);

      for (const { path, content } of providerFiles) {
        expect(content, `${path} imports from ee/`).not.toMatch(/from\s+['"].*ee\//);
      }
    });
  });

  describe('lifecycle — no ee imports', () => {
    it('should not import from /ee in any lifecycle file', () => {
      const lifecycleFiles = sourceFiles.filter((f) => /[/\\]lifecycle[/\\]/.test(f.path));
      expect(lifecycleFiles.length).toBeGreaterThan(0);

      for (const { path, content } of lifecycleFiles) {
        expect(content, `${path} imports from ee/`).not.toMatch(/from\s+['"].*ee\//);
      }
    });
  });

  describe('kill-switch — deterministic (no LLM/provider imports)', () => {
    it('should not import from providers/ or any AI SDK', () => {
      const ksFile = sourceFiles.find((f) => f.path.includes('kill-switch.ts'));
      expect(ksFile).toBeDefined();
      if (!ksFile) return;

      expect(ksFile.content).not.toMatch(/from\s+['"].*providers\//);
      expect(ksFile.content).not.toMatch(/from\s+['"].*@ai-sdk/);
      expect(ksFile.content).not.toMatch(/from\s+['"].*openai/);
      expect(ksFile.content).not.toMatch(/from\s+['"].*anthropic/);
    });
  });
});
