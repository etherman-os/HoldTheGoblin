"""CrewAI-friendly HoldTheGoblin guard helpers.

This file is intentionally dependency-light. Import it from a CrewAI project and
call ``after_kickoff`` after crew execution, or call ``verify`` wherever your
workflow exposes a completion hook.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class HoldTheGoblinResult:
    ok: bool
    report_path: str | None
    raw: dict[str, Any]


class HoldTheGoblinGuard:
    def __init__(self, root: str | Path = ".", command: str = "holdthegoblin") -> None:
        self.root = Path(root)
        self.command = command

    def verify(self, fail_closed: bool = True) -> HoldTheGoblinResult:
        completed = subprocess.run(
            [self.command, "verify", "--format", "json"],
            cwd=self.root,
            text=True,
            capture_output=True,
            check=False,
        )
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"HoldTheGoblin did not return JSON: {completed.stderr}") from exc

        result = HoldTheGoblinResult(
            ok=bool(payload.get("ok")),
            report_path=payload.get("reportPath"),
            raw=payload,
        )
        if fail_closed and not result.ok:
            raise RuntimeError(f"HoldTheGoblin verification failed. See {result.report_path}")
        return result

    def before_kickoff(self) -> None:
        return None

    def after_kickoff(self, fail_closed: bool = True) -> HoldTheGoblinResult:
        return self.verify(fail_closed=fail_closed)
