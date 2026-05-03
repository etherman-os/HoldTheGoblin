# CrewAI Adapter Example

Python projects can copy or import `integrations/crewai/holdthegoblin_guard.py`:

```py
from holdthegoblin_guard import HoldTheGoblinGuard

guard = HoldTheGoblinGuard(root=".")
result = crew.kickoff()
guard.after_kickoff(fail_closed=True)
```

TypeScript orchestrators can use:

```ts
import { createHoldTheGoblinCrewAIGuard } from "holdthegoblin";

const guard = createHoldTheGoblinCrewAIGuard({ root: process.cwd() });
await guard.afterKickoff();
```
