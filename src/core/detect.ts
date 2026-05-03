import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HoldTheGoblinConfig, PlannedCommand, ProjectDetection, ProjectKind } from './types.js';

const PACKAGE_SCRIPTS = ['typecheck', 'test', 'lint'] as const;

export function detectProject(root: string, config: HoldTheGoblinConfig): ProjectDetection {
  const kinds = new Set<ProjectKind>();
  const warnings: string[] = [];
  const testCommands: PlannedCommand[] = [];
  const securityCommands: PlannedCommand[] = [];

  if (existsSync(path.join(root, 'package.json'))) {
    kinds.add('javascript');
    testCommands.push(...detectJavaScript(root));
  }
  if (existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'pytest.ini')) || existsSync(path.join(root, 'setup.py')) || existsSync(path.join(root, 'requirements.txt'))) {
    kinds.add('python');
    testCommands.push(...detectPython(root));
  }
  if (existsSync(path.join(root, 'go.mod'))) {
    kinds.add('go');
    testCommands.push(command('go:test', 'Go tests', 'go test ./...', 'go', true, 'go.mod detected'));
  }
  if (existsSync(path.join(root, 'Cargo.toml'))) {
    kinds.add('rust');
    testCommands.push(command('rust:test', 'Rust tests', 'cargo test --workspace', 'rust', true, 'Cargo.toml detected'));
  }
  if (existsSync(path.join(root, 'pom.xml'))) {
    kinds.add('java');
    testCommands.push(command('java:maven-test', 'Maven tests', 'mvn test', 'java', true, 'pom.xml detected'));
  } else if (existsSync(path.join(root, 'build.gradle')) || existsSync(path.join(root, 'build.gradle.kts'))) {
    kinds.add('java');
    const gradle = existsSync(path.join(root, 'gradlew')) ? './gradlew test' : 'gradle test';
    testCommands.push(command('java:gradle-test', 'Gradle tests', gradle, 'java', true, 'Gradle build detected'));
  }

  for (const [kind, commands] of Object.entries(config.commands)) {
    for (const overrideCommand of commands ?? []) {
      const trimmed = overrideCommand.trim();
      if (trimmed === '') continue;
      testCommands.push(command(`custom:${kind}:${trimmed}`, `Custom ${kind}`, trimmed, kind as ProjectKind, true, 'Configured override'));
    }
  }

  if (config.security.semgrep) {
    securityCommands.push(command('semgrep', 'Semgrep SAST', 'semgrep scan --config auto --json', 'security', false, 'Semgrep CLI if installed'));
  }
  if (config.security.trivy) {
    securityCommands.push(command('trivy', 'Trivy filesystem scan', 'trivy filesystem --format json --scanners vuln,misconfig,secret .', 'security', false, 'Trivy CLI if installed'));
  }

  if (kinds.size === 0) kinds.add('unknown');
  if (testCommands.length === 0) {
    warnings.push('No test, lint, or typecheck command was detected.');
  }

  return {
    root,
    kinds: [...kinds],
    testCommands,
    securityCommands,
    warnings,
  };
}

function detectJavaScript(root: string): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  const runner = existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';

  for (const script of PACKAGE_SCRIPTS) {
    if (pkg.scripts?.[script]) {
      const run = runner === 'npm' ? `npm run ${script}` : `${runner} ${script}`;
      commands.push(command(`js:${script}`, `JS/TS ${script}`, run, 'javascript', script !== 'lint', `package.json script "${script}" detected`));
    }
  }

  if (hasPlaywright(root) && pkg.scripts?.test === undefined && pkg.scripts?.['test:e2e'] === undefined) {
    const run = runner === 'npm' ? 'npx playwright test' : `${runner} playwright test`;
    commands.push(command('js:playwright', 'Playwright smoke tests', run, 'javascript', false, 'Playwright config detected'));
  } else if (hasPlaywright(root) && pkg.scripts?.['test:e2e']) {
    const run = runner === 'npm' ? 'npm run test:e2e' : `${runner} test:e2e`;
    commands.push(command('js:playwright', 'Playwright smoke tests', run, 'javascript', false, 'Playwright test:e2e script detected'));
  }

  return commands;
}

function detectPython(root: string): PlannedCommand[] {
  const hasTests = existsSync(path.join(root, 'tests')) || existsSync(path.join(root, 'test'));
  const hasPytest = existsSync(path.join(root, 'pytest.ini')) || existsSync(path.join(root, 'pyproject.toml'));
  if (!hasTests && !hasPytest) return [];
  return [command('python:pytest', 'Python tests', 'python -m pytest -q', 'python', true, 'pytest config or tests directory detected')];
}

function hasPlaywright(root: string): boolean {
  return (
    existsSync(path.join(root, 'playwright.config.ts')) ||
    existsSync(path.join(root, 'playwright.config.js')) ||
    existsSync(path.join(root, 'playwright.config.mjs')) ||
    existsSync(path.join(root, 'playwright.config.cjs'))
  );
}

function command(id: string, label: string, commandText: string, kind: ProjectKind | 'security' | 'doctor', required: boolean, reason: string): PlannedCommand {
  return { id, label, command: commandText, kind, required, reason };
}
