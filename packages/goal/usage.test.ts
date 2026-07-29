import { describe, expect, it } from "vitest";

import { GoalEpisode } from "./goal-episode.ts";
import { tokenDeltaFromUsage } from "./usage.ts";

describe("goal usage", () => {
  it("counts input, output, and cache tokens", () => {
    expect(tokenDeltaFromUsage({ input: 100, output: 25, cacheRead: 50, cacheWrite: 75 })).toBe(
      250,
    );
  });

  it("prefers total tokens and clamps invalid usage", () => {
    expect(
      tokenDeltaFromUsage({
        cacheRead: 50,
        cacheWrite: 75,
        input: 100,
        output: 25,
        totalTokens: 123,
      }),
    ).toBe(123);
    expect(tokenDeltaFromUsage({ input: -100, output: 25, cacheRead: 50 })).toBe(0);
    expect(tokenDeltaFromUsage(undefined)).toBe(0);
    expect(tokenDeltaFromUsage({ totalTokens: Number.NaN })).toBe(0);
  });

  it("aggregates turns and retries into one settled episode", () => {
    const episode = new GoalEpisode("goal", 1_000);
    episode.accountTurn({ totalTokens: 10 });
    episode.accountTurn({ totalTokens: 15 });
    episode.addMessages([{ role: "assistant", stopReason: "error" }]);
    episode.addMessages([{ role: "assistant", stopReason: "stop" }]);

    expect(episode.observation(3_400)).toMatchObject({
      aborted: false,
      elapsedSeconds: 2,
      terminalError: false,
      tokenDelta: 25,
    });
  });
});
