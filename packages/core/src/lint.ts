/**
 * Lint engine — collects lint rules from all loaded plugins, runs them
 * against compiled output, respects @lint.ignore tags, and applies
 * severity overrides from config.
 */

import type { CompilerOutput, LintContext, LintResult, NamespacePlugin, ResolvedConfig } from './compiler/types.ts'

/** Parsed @lint.ignore tag */
interface LintIgnore {
  /** Rule name to ignore (e.g. "audit.require-audit") */
  ruleName: string
  /** Mandatory reason for suppression */
  reason: string
  /** SQL object name this ignore applies to */
  objectName: string
  /** Source file */
  sourceFile: string
}

/**
 * Run all lint rules from loaded plugins against compiled outputs.
 *
 * Collects lintRules from every plugin, runs each rule's check function,
 * applies severity overrides from config.lint.rules, and respects
 * @lint.ignore tags found in file tags.
 */
export function lint(
  outputs: CompilerOutput[],
  plugins: Map<string, NamespacePlugin>,
  config: ResolvedConfig,
  atlasRealm?: unknown,
): LintResult[] {
  const results: LintResult[] = []
  const lintConfig = config.lint ?? {}
  const ruleOverrides = lintConfig.rules ?? {}

  // 1. Collect all lint rules from plugins
  const allRules = collectRules(plugins)

  // 2. Collect all @lint.ignore tags from outputs
  const ignores = collectIgnores(outputs)

  // 3. Build lint context
  const ctx: LintContext = { outputs, plugins, config, atlasRealm }

  // 4. Run each rule
  for (const rule of allRules) {
    // Determine effective severity
    const effectiveSeverity = ruleOverrides[rule.name] ?? rule.default
    if (effectiveSeverity === 'off') continue

    // Run the check
    const diagnostics = rule.check(ctx)

    for (const diag of diagnostics) {
      // Check if this diagnostic is suppressed by @lint.ignore
      const ignore = ignores.find(
        (ig) => ig.ruleName === rule.name && ig.objectName === diag.objectName && ig.sourceFile === diag.sourceFile,
      )

      if (ignore) {
        results.push({
          ruleName: rule.name,
          severity: 'skip',
          objectName: diag.objectName,
          sourceFile: diag.sourceFile,
          message: diag.message,
          ignoreReason: ignore.reason,
        })
      } else {
        results.push({
          ruleName: rule.name,
          severity: effectiveSeverity,
          objectName: diag.objectName,
          sourceFile: diag.sourceFile,
          message: diag.message,
        })
      }
    }
  }

  return results
}

/** Collect all lint rules from all plugins */
function collectRules(plugins: Map<string, NamespacePlugin>) {
  const rules = []
  for (const plugin of plugins.values()) {
    if (plugin.lintRules) {
      rules.push(...plugin.lintRules)
    }
  }
  return rules
}

/** Collect @lint.ignore tags from compiled outputs' fileTags */
function collectIgnores(outputs: CompilerOutput[]): LintIgnore[] {
  const ignores: LintIgnore[] = []

  for (const output of outputs) {
    for (const obj of output.fileTags) {
      for (const tag of obj.tags) {
        if (tag.namespace === 'lint' && tag.tag === 'ignore') {
          const args = tag.args
          let ruleName: string | undefined
          let reason: string | undefined

          if (Array.isArray(args)) {
            ruleName = args[0] as string | undefined
            reason = args[1] as string | undefined
          }

          if (ruleName && reason) {
            ignores.push({
              ruleName,
              reason,
              objectName: obj.objectName,
              sourceFile: output.sourceFile,
            })
          }
        }
      }
    }
  }

  return ignores
}
