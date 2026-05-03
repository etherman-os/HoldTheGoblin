import { verify, type VerifyOptions } from '../core/verify.js';
import type { VerifyResult } from '../core/types.js';

export interface LangGraphGuardOptions extends Partial<VerifyOptions> {
  root?: string;
  failClosed?: boolean;
  stateKey?: string;
}

export type LangGraphState = Record<string, unknown>;

export function createHoldTheGoblinLangGraphNode(options: LangGraphGuardOptions = {}) {
  const stateKey = options.stateKey ?? 'holdTheGoblin';
  const failClosed = options.failClosed ?? true;
  return async function holdTheGoblinNode<TState extends LangGraphState>(state: TState): Promise<TState & Record<string, VerifyResult>> {
    const result = await verify({
      root: options.root ?? process.cwd(),
      writeReport: options.writeReport,
      includeTests: options.includeTests,
      includeSecurity: options.includeSecurity,
    });
    if (!result.ok && failClosed) {
      throw new Error(`HoldTheGoblin verification failed. See ${result.reportPath ?? '.holdthegoblin/latest.md'}.`);
    }
    return { ...state, [stateKey]: result } as TState & Record<string, VerifyResult>;
  };
}

export function createHoldTheGoblinLangGraphConditionalEdge(options: LangGraphGuardOptions = {}) {
  const stateKey = options.stateKey ?? 'holdTheGoblin';
  return function holdTheGoblinRoute(state: LangGraphState): 'pass' | 'fail' {
    const result = state[stateKey] as VerifyResult | undefined;
    return result?.ok ? 'pass' : 'fail';
  };
}
