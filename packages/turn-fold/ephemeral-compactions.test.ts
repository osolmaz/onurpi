import { describe, expect, it } from "vitest";

import {
  closeCompactionRegistry,
  EphemeralCompactionRegistry,
  processCompactionRegistry,
  type EphemeralCompactionAssociation,
} from "./ephemeral-compactions.ts";

function association(
  compactionEntryId: string,
  timestamp = 120,
  turnStartedAt = 100,
): EphemeralCompactionAssociation {
  return { compactionEntryId, timestamp, turnStartedAt };
}

describe("ephemeral compaction registry", () => {
  it("shares exact compaction associations across registry instances", () => {
    const store = new Map<string, Map<string, EphemeralCompactionAssociation>>();
    const beforeReload = new EphemeralCompactionRegistry(store);
    const afterReload = new EphemeralCompactionRegistry(store);

    beforeReload.remember("session-a", association("compact-1"));
    beforeReload.remember("session-a", association("compact-1"));

    expect(afterReload.associationsFor("session-a").get("compact-1")).toEqual(
      association("compact-1"),
    );
  });

  it("isolates sessions and ignores invalid associations", () => {
    const registry = new EphemeralCompactionRegistry();

    registry.remember("session-a", association("compact-a"));
    registry.remember("session-b", association("compact-b"));
    registry.remember("", association("compact-invalid"));
    registry.remember("session-a", association(""));
    registry.remember("session-a", association("bad-time", Number.NaN));

    expect([...registry.associationsFor("session-a")]).toEqual([
      ["compact-a", association("compact-a")],
    ]);
    expect([...registry.associationsFor("session-b")]).toEqual([
      ["compact-b", association("compact-b")],
    ]);
    expect(registry.associationsFor("")).toEqual(new Map());
  });

  it("survives extension reload in the process registry and clears on exit", () => {
    const beforeReload = processCompactionRegistry();
    beforeReload.clear();
    beforeReload.remember("session-a", association("compact-1"));

    closeCompactionRegistry(beforeReload, "reload");
    const afterReload = processCompactionRegistry();
    expect(afterReload.associationsFor("session-a").has("compact-1")).toBe(true);

    closeCompactionRegistry(afterReload, "quit");
    expect(processCompactionRegistry().associationsFor("session-a")).toEqual(new Map());
  });
});
