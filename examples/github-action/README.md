# GitHub Actions Gate

Copy `holdthegoblin-verify.yml` into `.github/workflows/holdthegoblin.yml` in a downstream repository.

The workflow validates `.holdthegoblin/config.json` and runs `holdthegoblin verify` on pull requests. It is a CI gate: failed tests, blocking secret findings, blocking scanner findings, and strict policy failures fail the pull request check.

The verify step passes `--github-step-summary`, which appends a concise Markdown summary to the GitHub Actions run page through `GITHUB_STEP_SUMMARY`. It also passes `--github-annotations`, which emits escaped workflow command annotations for failed checks, failed commands, warnings/skips, and scanner findings. Both are report-only output; they do not change enforcement. The workflow also uploads `.holdthegoblin/latest.md`, `.holdthegoblin/latest.html`, and immutable run reports as the `holdthegoblin-evidence` artifact.

Semgrep and Trivy are optional external CLIs. Install them in earlier workflow steps if the repository should use those scanners; otherwise HoldTheGoblin reports them as skipped, not passed.

The workflow includes commented Semgrep and Trivy setup recipes. Replace placeholder versions with reviewed pins before enabling them. For Trivy, review Aqua's current advisory status and avoid floating action tags in security-sensitive CI.

For non-npm projects, keep the Node setup step because HoldTheGoblin runs on Node, then add the project dependency setup commands needed by the repository before the verify step.
