# LangGraph Adapter Example

```ts
import { StateGraph } from "@langchain/langgraph";
import { createHoldTheGoblinLangGraphNode } from "holdthegoblin";

const guard = createHoldTheGoblinLangGraphNode({
  root: process.cwd(),
  failClosed: true
});

const graph = new StateGraph({ channels: {} })
  .addNode("guard", guard);
```

The adapter is dependency-light: HoldTheGoblin does not pull LangGraph into your project. It returns a normal async node function that can be added to your graph.
