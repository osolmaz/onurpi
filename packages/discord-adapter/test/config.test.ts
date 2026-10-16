import { describe, expect, it } from "vitest";
import { parseAdapterConfig } from "../src/config.ts";
import { CHANNEL, OWNER } from "./helpers.ts";

describe("parseAdapterConfig", () => {
  it("fills in safe defaults", () => {
    expect(parseAdapterConfig({ ownerIds: [OWNER] })).toEqual({
      channelIds: [],
      directMessages: true,
      ownerIds: [OWNER],
      requireMention: true,
    });
  });

  it("keeps explicit choices", () => {
    expect(
      parseAdapterConfig({
        channelIds: [CHANNEL],
        directMessages: false,
        ownerIds: [OWNER],
        requireMention: false,
      }),
    ).toEqual({
      channelIds: [CHANNEL],
      directMessages: false,
      ownerIds: [OWNER],
      requireMention: false,
    });
  });

  it.each([
    [null, "discord must be an object"],
    [[], "discord must be an object"],
    [{}, "discord.ownerIds must be a list of Discord ids"],
    [{ ownerIds: [] }, "discord.ownerIds must name at least one owner"],
    [{ ownerIds: [123] }, "discord.ownerIds[0] must be a Discord id"],
    [{ ownerIds: ["abc"] }, "discord.ownerIds[0] must be a Discord id"],
    [{ channelIds: ["1"], ownerIds: [OWNER] }, "discord.channelIds[0] must be a Discord id"],
    [{ ownerIds: [OWNER], requireMention: "yes" }, "discord.requireMention must be true or false"],
  ])("rejects %j", (value, error) => {
    expect(() => parseAdapterConfig(value)).toThrow(error);
  });
});
