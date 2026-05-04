# GitHub Actions Gate

Copy `holdthegoblin-verify.yml` into `.github/workflows/holdthegoblin.yml` in a downstream repository.

The workflow validates `.holdthegoblin/config.json` and runs `holdthegoblin verify` on pull requests. It is a CI gate: failed tests, blocking secret findings, blocking scanner findings, and strict policy failures fail the pull request check.

The verify step passes `--github-step-summary`, which appends a concise Markdown summary to the GitHub Actions run page through `GITHUB_STEP_SUMMARY`. The summary is report-only output; it does not change enforcement. The workflow also uploads `.holdthegoblin/latest.md`, `.holdthegoblin/latest.html`, and immutable run reports as the `holdthegoblin-evidence` artifact.

Semgrep and Trivy are optional external CLIs. Install them in earlier workflow steps if the repository should use those scanners; otherwise HoldTheGoblin reports them as skipped, not passed.

For non-npm projects, keep the Node setup step because HoldTheGoblin runs on Node, then add the project dependency setup commands needed by the repository before the verify step.
