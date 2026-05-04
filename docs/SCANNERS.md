# Scanner Setup

HoldTheGoblin has a built-in secret scanner. Semgrep and Trivy are optional external CLIs: if their binaries are missing, verification reports them as skipped, not passed.

Install external scanners in reviewed CI steps before `holdthegoblin verify` when a repository needs those checks.

## Semgrep

Semgrep Community Edition can be installed with Python packaging in CI. Prefer pinning a reviewed Semgrep version instead of floating on latest:

```yaml
- uses: actions/setup-python@v6
  with:
    python-version: "3.12"

- name: Install Semgrep
  run: python -m pip install "semgrep==<reviewed-version>"
```

HoldTheGoblin runs:

```bash
semgrep scan --config auto --json
```

Reference: https://semgrep.dev/docs/deployment/oss-deployment

## Trivy

Trivy setup needs extra supply-chain care. Aqua's March 2026 advisory says Trivy `v0.69.4`, `trivy-action` versions before `0.35.0`, and `setup-trivy` versions before `0.2.6` were affected by a temporary compromise. Before adding Trivy to CI, review the current advisory, choose a non-affected Trivy version, and pin GitHub Actions to immutable commit SHAs where your policy requires it.

Example with `setup-trivy` pinned by commit SHA:

```yaml
- name: Install Trivy
  uses: aquasecurity/setup-trivy@<reviewed-40-character-commit-sha>
  with:
    version: <reviewed-trivy-version>
    cache: true
```

HoldTheGoblin runs:

```bash
trivy filesystem --format json --scanners vuln,misconfig,secret .
```

References:

- https://trivy.dev/latest/getting-started/installation/
- https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23

## Policy Notes

- Do not treat skipped Semgrep or Trivy checks as passed.
- Keep scanner installation steps before `holdthegoblin verify`.
- Review scanner action pins and binary versions as part of CI maintenance.
- If a repository intentionally cannot run a scanner, document that decision and disable it in `.holdthegoblin/config.json`; strict/release workflows surface scanner disablement as a policy-floor finding.
