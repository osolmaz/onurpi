import { afterEach, describe, expect, it, vi } from "vitest";
import { relayRequest } from "../src/discordjs.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("relayRequest", () => {
  it("routes the api path through the relay without a credential header", async () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchStub);

    await relayRequest(
      "http://100.119.251.79:8771",
      "https://discord.com/api/v10/channels/1/messages",
      {
        method: "POST",
        headers: {
          Authorization: "Bot openshell:resolve:stub",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "hello" }),
      },
    );

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://100.119.251.79:8771/relay/channels/1/messages");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("refuses a url without the discord api path", () => {
    expect(() =>
      relayRequest("http://relay:8771", "https://evil.example/api/v10/channels/1/messages", {}),
    ).toThrow("does not carry the Discord API path");
  });
});
