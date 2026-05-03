import { verify, type VerifyOptions } from '../core/verify.js';
import type { VerifyResult } from '../core/types.js';

export interface CrewAIGuardOptions extends Partial<VerifyOptions> {
  root?: string;
  failClosed?: boolean;
}

export interface CrewAIGuard {
  verify(): Promise<VerifyResult>;
  beforeKickoff(): Promise<void>;
  afterKickoff(): Promise<VerifyResult>;
}

export function createHoldTheGoblinCrewAIGuard(options: CrewAIGuardOptions = {}): CrewAIGuard {
  const failClosed = options.failClosed ?? true;
  async function run(): Promise<VerifyResult> {
    return verify({
      root: options.root ?? process.cwd(),
      writeReport: options.writeReport,
      includeTests: options.includeTests,
      includeSecurity: options.includeSecurity,
    });
  }

  return {
    verify: run,
    async beforeKickoff() {
      return;
    },
    async afterKickoff() {
      const result = await run();
      if (!result.ok && failClosed) {
        throw new Error(`HoldTheGoblin verification failed. See ${result.reportPath ?? '.holdthegoblin/latest.md'}.`);
      }
      return result;
    },
  };
}
