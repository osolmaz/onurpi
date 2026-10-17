import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  splitForDiscord,
  type AgentPort,
  type BridgeLog,
  type ChatTransport,
} from "@onurpi/discord-adapter";

/** One scheduled prompt that the host scheduler delivers to the agent. */
export type Delivery = {
  readonly job: string;
  readonly scheduledFor: string;
  readonly channelId: string;
  readonly prompt: string;
};

/** Which deliveries already have their answer in Discord, kept with the agent's other state. */
export type JobLedger = {
  posted(requestId: string): Promise<boolean>;
  markPosted(requestId: string, messageId: string): Promise<void>;
};

export const INBOX_POLL_MS = 5000;

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

/**
 * The file name of a delivery: the job id and the scheduled time. A retried delivery of the same
 * scheduled time has the same name, and the name is the agent request id, so it runs once.
 */
export function deliveryName(job: string, scheduledFor: string): string {
  if (!JOB_ID.test(job)) {
    throw new Error(`A job id may hold only letters, digits, '_', '.', and '-': ${job}`);
  }
  const time = new Date(scheduledFor);
  if (Number.isNaN(time.getTime())) throw new Error(`Not a valid scheduled time: ${scheduledFor}`);
  return `${job}@${time.toISOString()}.json`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Writes a delivery into the inbox once. Returns false when it is already there or answered. */
export async function deliver(inbox: string, delivery: Delivery): Promise<boolean> {
  const name = deliveryName(delivery.job, delivery.scheduledFor);
  await mkdir(join(inbox, "done"), { recursive: true });
  if ((await exists(join(inbox, name))) || (await exists(join(inbox, "done", name)))) return false;
  const temporary = join(inbox, `.${name}.${String(process.pid)}.tmp`);
  await writeFile(temporary, `${JSON.stringify(delivery)}\n`, { mode: 0o644 });
  await rename(temporary, join(inbox, name));
  return true;
}

function parseDelivery(value: unknown): Delivery {
  if (typeof value !== "object" || value === null) throw new Error("a delivery must be an object");
  const field = (key: keyof Delivery): string => {
    const item: unknown = Reflect.get(value, key);
    if (typeof item !== "string" || item.trim() === "")
      throw new Error(`delivery.${key} must be text`);
    return item;
  };
  return {
    channelId: field("channelId"),
    job: field("job"),
    prompt: field("prompt"),
    scheduledFor: field("scheduledFor"),
  };
}

export type InboxOptions = {
  readonly folder: string;
  readonly agent: AgentPort;
  readonly transport: Pick<ChatTransport, "send">;
  readonly ledger: JobLedger;
  /** Discord channels that deliveries may post to. Others are refused. */
  readonly channelIds: readonly string[];
  readonly log: BridgeLog;
  readonly pollMs?: number;
};

/**
 * Answers the deliveries in an inbox folder, oldest name first, and posts each answer to the
 * delivery's Discord channel. An answered delivery moves to `done/`.
 */
export class Inbox {
  private readonly options: InboxOptions;
  private timer: NodeJS.Timeout | undefined;
  private scanning: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(options: InboxOptions) {
    this.options = options;
  }

  start(): void {
    this.next(0);
  }

  /** Stops polling and waits for the current scan to finish. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.scanning;
  }

  private next(delay: number): void {
    this.timer = setTimeout(() => {
      this.scanning = this.scan().finally(() => {
        if (!this.stopped) this.next(this.options.pollMs ?? INBOX_POLL_MS);
      });
    }, delay);
  }

  /** Answers every delivery that is in the inbox now. A failed one stays for the next scan. */
  async scan(): Promise<void> {
    const { folder, log } = this.options;
    await mkdir(join(folder, "done"), { recursive: true });
    const names = (await readdir(folder)).filter(
      (name) => name.endsWith(".json") && !name.startsWith("."),
    );
    for (const name of names.sort()) {
      try {
        await this.answer(name);
      } catch (error) {
        log("job_failed", { delivery: name, error: String(error) });
      }
    }
  }

  private async answer(name: string): Promise<void> {
    const { agent, channelIds, folder, ledger, log, transport } = this.options;
    const delivery = parseDelivery(JSON.parse(await readFile(join(folder, name), "utf8")));
    const requestId = `job:${name.slice(0, -".json".length)}`;
    if (!channelIds.includes(delivery.channelId)) {
      log("job_refused", { channel: delivery.channelId, delivery: name });
    } else if (!(await ledger.posted(requestId))) {
      const reply = await agent.ask({
        conversationKey: `job:${delivery.job}`,
        requestId,
        text: delivery.prompt,
      });
      const answer =
        reply.kind === "answer"
          ? reply.text
          : `Sorry, the job ${delivery.job} could not finish: ${reply.reason}`;
      let first: string | undefined;
      for (const chunk of splitForDiscord(answer)) {
        const id = await transport.send(delivery.channelId, chunk);
        first ??= id;
      }
      await ledger.markPosted(requestId, first ?? "");
      log("job_answered", { delivery: name, outcome: reply.kind });
    }
    await rename(join(folder, name), join(folder, "done", name));
  }
}
