import { randomUUID } from 'node:crypto';

export function createAgentRun(agent, input, { now = () => new Date(), id = randomUUID() } = {}) {
  const startedAt = now();
  const trace = [];

  return {
    id,
    agent,
    input,
    trace,
    record(step, summary, data = {}) {
      trace.push({
        step,
        summary,
        data,
        at: now().toISOString(),
      });
    },
    complete(output, metadata = {}) {
      const finishedAt = now();
      return {
        run: {
          id,
          agent,
          status: 'completed',
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
          ...metadata,
        },
        input,
        output,
        trace,
      };
    },
  };
}
