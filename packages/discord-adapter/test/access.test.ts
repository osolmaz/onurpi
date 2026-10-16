import { describe, expect, it } from "vitest";
import { acceptMessage, conversationKey } from "../src/access.ts";
import { parseAdapterConfig } from "../src/config.ts";
import { BOT, CHANNEL, message, OTHER_CHANNEL, OWNER, STRANGER } from "./helpers.ts";

const config = parseAdapterConfig({ channelIds: [CHANNEL], ownerIds: [OWNER] });

describe("acceptMessage", () => {
  it("answers an owner who mentions the bot in an allowed channel, without the mention", () => {
    expect(acceptMessage(message(), config, BOT)).toBe("hello");
    expect(acceptMessage(message({ content: `<@!${BOT}>  run the tests ` }), config, BOT)).toBe(
      "run the tests",
    );
  });

  it("ignores other users, other bots, and the bot itself", () => {
    expect(acceptMessage(message({ authorId: STRANGER }), config, BOT)).toBeNull();
    expect(
      acceptMessage(message({ authorId: STRANGER, authorIsBot: true }), config, BOT),
    ).toBeNull();
    expect(acceptMessage(message({ authorId: BOT }), config, BOT)).toBeNull();
  });

  it("answers a bot only when the configuration lists it as an owner", () => {
    expect(acceptMessage(message({ authorIsBot: true }), config, BOT)).toBe("hello");
  });

  it("answers no server channel when no channel is allowed", () => {
    expect(acceptMessage(message(), parseAdapterConfig({ ownerIds: [OWNER] }), BOT)).toBeNull();
  });

  it("ignores channels that are not allowed, but follows a thread's parent channel", () => {
    expect(acceptMessage(message({ channelId: OTHER_CHANNEL }), config, BOT)).toBeNull();
    expect(
      acceptMessage(message({ channelId: OTHER_CHANNEL, parentChannelId: CHANNEL }), config, BOT),
    ).toBe("hello");
  });

  it("needs a mention in server channels unless the configuration turns that off", () => {
    const plain = message({ content: "hello", mentionsBot: false });
    expect(acceptMessage(plain, config, BOT)).toBeNull();
    const open = parseAdapterConfig({
      channelIds: [CHANNEL],
      ownerIds: [OWNER],
      requireMention: false,
    });
    expect(acceptMessage(plain, open, BOT)).toBe("hello");
  });

  it("answers direct messages without a mention unless they are turned off", () => {
    const direct = message({
      channelId: OTHER_CHANNEL,
      content: "hi",
      isDirect: true,
      mentionsBot: false,
    });
    expect(acceptMessage(direct, config, BOT)).toBe("hi");
    const closed = parseAdapterConfig({ directMessages: false, ownerIds: [OWNER] });
    expect(acceptMessage(direct, closed, BOT)).toBeNull();
  });

  it("ignores a message that is only a mention", () => {
    expect(acceptMessage(message({ content: `<@${BOT}>` }), config, BOT)).toBeNull();
  });
});

describe("conversationKey", () => {
  it("gives each channel or thread its own conversation", () => {
    expect(conversationKey(message())).toBe(`discord:${CHANNEL}`);
    expect(conversationKey(message({ channelId: OTHER_CHANNEL, parentChannelId: CHANNEL }))).toBe(
      `discord:${OTHER_CHANNEL}`,
    );
  });
});
