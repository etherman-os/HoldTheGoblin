import type { CheckResult, CommandResult, EdgeCaseSuggestion, Finding, HoldTheGoblinConfig } from './types.js';

export interface EvaluationOptions {
  enforcePolicyFloor?: boolean;
}

export function evaluateResults(
  config: HoldTheGoblinConfig,
  testResults: CommandResult[],
  findings: Finding[],
  warnings: string[],
  edgeCases: EdgeCaseSuggestion[] = [],
  options: EvaluationOptions = {}
): CheckResult[] {
  const checks: CheckResult[] = [];
  const policyDowngrades = findConfigPolicyDowngrades(config);
  if (policyDowngrades.length > 0) {
    const status = options.enforcePolicyFloor || config.mode === 'strict' ? 'fail' : 'warn';
    checks.push({
      id: 'config:policy-floor',
      label: 'Configuration policy floor',
      status,
      severity: status === 'fail' ? 'high' : 'medium',
      message: `${policyDowngrades.length} policy downgrade(s) detected: ${policyDowngrades.join('; ')}.`,
    });
  }

  const runnableTests = testResults.filter((result) => !result.skipped);
  if (runnableTests.length === 0) {
    const status = options.enforcePolicyFloor || config.mode === 'strict' || config.failPolicy.failOnMissingTests ? 'fail' : 'warn';
    checks.push({
      id: 'tests:missing',
      label: 'Test coverage gate',
      status,
      severity: status === 'fail' ? 'high' : 'medium',
      message: 'No runnable test, lint, or typecheck command was detected.',
    });
  }

  for (const result of runnableTests) {
    const failed = result.exitCode !== 0 || result.timedOut;
    checks.push({
      id: `command:${result.id}`,
      label: result.label,
      status: failed && config.failPolicy.failOnTestFailure ? 'fail' : failed ? 'warn' : 'pass',
      severity: failed ? 'high' : 'info',
      message: failed ? commandFailureMessage(result) : `Command passed: ${result.command}`,
      evidence: {
        command: result.command,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderrTail: tail(result.stderr),
        stdoutTail: tail(result.stdout),
      },
    });
  }

  const secretFindings = findings.filter((finding) => finding.scanner === 'secret');
  if (secretFindings.length > 0) {
    checks.push({
      id: 'security:secrets',
      label: 'Secret scan',
      status: config.failPolicy.failOnSecrets ? 'fail' : 'warn',
      severity: 'critical',
      message: `${secretFindings.length} credential-like finding(s) detected.`,
      evidence: secretFindings.slice(0, 20),
    });
  } else {
    checks.push({
      id: 'security:secrets',
      label: 'Secret scan',
      status: 'pass',
      severity: 'info',
      message: 'No credential-like values detected by built-in scanner.',
    });
  }

  const semgrepFindings = findings.filter((finding) => finding.scanner === 'semgrep');
  const blockingSemgrep = semgrepFindings.filter((finding) => config.failPolicy.semgrepSeverities.includes(finding.severity.toUpperCase()));
  if (blockingSemgrep.length > 0) {
    checks.push({
      id: 'security:semgrep',
      label: 'Semgrep gate',
      status: 'fail',
      severity: 'high',
      message: `${blockingSemgrep.length} blocking Semgrep finding(s).`,
      evidence: blockingSemgrep.slice(0, 20),
    });
  } else if (semgrepFindings.length > 0) {
    checks.push({
      id: 'security:semgrep',
      label: 'Semgrep gate',
      status: 'warn',
      severity: 'medium',
      message: `${semgrepFindings.length} non-blocking Semgrep finding(s).`,
      evidence: semgrepFindings.slice(0, 20),
    });
  }

  const trivyFindings = findings.filter((finding) => finding.scanner === 'trivy');
  const blockingTrivy = trivyFindings.filter((finding) => config.failPolicy.trivySeverities.includes(finding.severity.toUpperCase()));
  if (blockingTrivy.length > 0) {
    checks.push({
      id: 'security:trivy',
      label: 'Trivy gate',
      status: 'fail',
      severity: 'critical',
      message: `${blockingTrivy.length} blocking Trivy finding(s).`,
      evidence: blockingTrivy.slice(0, 20),
    });
  } else if (trivyFindings.length > 0) {
    checks.push({
      id: 'security:trivy',
      label: 'Trivy gate',
      status: 'warn',
      severity: 'medium',
      message: `${trivyFindings.length} non-blocking Trivy finding(s).`,
      evidence: trivyFindings.slice(0, 20),
    });
  }

  for (const warning of warnings) {
    const blocking = /output exceeded .*truncated/i.test(warning);
    checks.push({
      id: `warning:${warning}`,
      label: blocking ? 'Scanner evidence' : 'Project detection',
      status: blocking || config.mode === 'strict' ? 'fail' : 'warn',
      severity: blocking ? 'high' : 'medium',
      message: warning,
    });
  }

  if (edgeCases.length > 0) {
    checks.push({
      id: 'tests:edge-cases',
      label: 'Edge-case test suggestions',
      status: 'warn',
      severity: 'medium',
      message: `${edgeCases.length} edge-case test suggestion(s) found for risky code paths.`,
      evidence: edgeCases,
    });
  }

  return checks;
}

export function isOk(checks: CheckResult[]): boolean {
  return checks.every((check) => check.status !== 'fail');
}

function commandFailureMessage(result: CommandResult): string {
  if (result.timedOut) return `Command timed out: ${result.command}`;
  return `Command failed with exit code ${result.exitCode}: ${result.command}`;
}

function tail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4000) return trimmed;
  return trimmed.slice(-4000);
}

function findConfigPolicyDowngrades(config: HoldTheGoblinConfig): string[] {
  const downgrades: string[] = [];
  if (!config.failPolicy.failOnTestFailure) downgrades.push('test failures do not block completion');
  if (!config.failPolicy.failOnSecrets) downgrades.push('secret findings do not block completion');
  if (!config.security.secretScan) downgrades.push('built-in secret scanning is disabled');
  if (!config.security.semgrep) downgrades.push('Semgrep policy is disabled');
  if (!config.security.trivy) downgrades.push('Trivy policy is disabled');
  if (!includesSeverity(config.failPolicy.semgrepSeverities, 'ERROR')) downgrades.push('Semgrep ERROR severity is not blocking');
  if (!includesSeverity(config.failPolicy.trivySeverities, 'HIGH')) downgrades.push('Trivy HIGH severity is not blocking');
  if (!includesSeverity(config.failPolicy.trivySeverities, 'CRITICAL')) downgrades.push('Trivy CRITICAL severity is not blocking');
  return downgrades;
}

function includesSeverity(values: string[], expected: string): boolean {
  return values.some((value) => value.toUpperCase() === expected);
}
