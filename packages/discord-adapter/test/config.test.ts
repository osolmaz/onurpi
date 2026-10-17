import { describe, expect, it } from "vitest";
import { answersWithoutMention, parseAdapterConfig } from "../src/config.ts";
import { CHANNEL, GUILD, oneChannel, OTHER_CHANNEL, OWNER } from "./helpers.ts";

describe("parseAdapterConfig", () => {
  it("answers direct messages and no server channel by default", () => {
    expect(parseAdapterConfig({ ownerIds: [OWNER] })).toEqual({
      directMessages: true,
      guilds: {},
      ownerIds: [OWNER],
    });
  });

  it("needs a mention in a listed channel unless the server or the channel turns it off", () => {
    expect(parseAdapterConfig(oneChannel()).guilds).toEqual({
      [GUILD]: { channels: { [CHANNEL]: { enabled: true, requireMention: true } } },
    });
    expect(
      parseAdapterConfig(oneChannel({}, { requireMention: false })).guilds[GUILD]?.channels[
        CHANNEL
      ],
    ).toEqual({
      enabled: true,
      requireMention: false,
    });
    const both = {
      guilds: {
        [GUILD]: {
          channels: { [CHANNEL]: { requireMention: true }, [OTHER_CHANNEL]: { enabled: false } },
          requireMention: false,
        },
      },
      ownerIds: [OWNER],
    };
    expect(parseAdapterConfig(both).guilds[GUILD]?.channels).toEqual({
      [CHANNEL]: { enabled: true, requireMention: true },
      [OTHER_CHANNEL]: { enabled: false, requireMention: false },
    });
  });

  it("keeps direct messages off when asked", () => {
    expect(parseAdapterConfig({ directMessages: false, ownerIds: [OWNER] }).directMessages).toBe(
      false,
    );
  });

  it.each([
    [null, "discord must be an object"],
    [[], "discord must be an object"],
    [{}, "discord.ownerIds must be a list of Discord ids"],
    [{ ownerIds: [] }, "discord.ownerIds must name at least one owner"],
    [{ ownerIds: [123] }, "discord.ownerIds[0] must be a Discord id"],
    [{ ownerIds: ["abc"] }, "discord.ownerIds[0] must be a Discord id"],
    [{ guilds: [], ownerIds: [OWNER] }, "discord.guilds must be an object"],
    [{ guilds: { general: {} }, ownerIds: [OWNER] }, "discord.guilds.general must be a Discord id"],
    [
      { guilds: { [GUILD]: { channels: { "1": {} } } }, ownerIds: [OWNER] },
      `discord.guilds.${GUILD}.channels.1 must be a Discord id`,
    ],
    [
      { guilds: { [GUILD]: { channels: { [CHANNEL]: true } } }, ownerIds: [OWNER] },
      `discord.guilds.${GUILD}.channels.${CHANNEL} must be an object`,
    ],
    [
      oneChannel({ requireMention: "yes" }),
      `discord.guilds.${GUILD}.channels.${CHANNEL}.requireMention must be true or false`,
    ],
    [
      oneChannel({}, { requireMention: 1 }),
      `discord.guilds.${GUILD}.requireMention must be true or false`,
    ],
    [
      oneChannel({ enabled: "no" }),
      `discord.guilds.${GUILD}.channels.${CHANNEL}.enabled must be true or false`,
    ],
  ])("rejects %j", (value, error) => {
    expect(() => parseAdapterConfig(value)).toThrow(error);
  });
});

describe("answersWithoutMention", () => {
  it("is true only when an enabled channel needs no mention", () => {
    expect(answersWithoutMention(parseAdapterConfig(oneChannel()))).toBe(false);
    expect(answersWithoutMention(parseAdapterConfig(oneChannel({ requireMention: false })))).toBe(
      true,
    );
    expect(
      answersWithoutMention(
        parseAdapterConfig(oneChannel({ enabled: false, requireMention: false })),
      ),
    ).toBe(false);
  });
});
