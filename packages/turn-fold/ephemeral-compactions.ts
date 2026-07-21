export type CompactionReason = "manual" | "overflow" | "threshold";

export type EphemeralCompactionAssociation = Readonly<{
  compactionEntryId: string;
  timestamp: number;
  turnStartedAt: number;
}>;

type SessionAssociations = Map<string, EphemeralCompactionAssociation>;
type RegistryStore = Map<string, SessionAssociations>;

const PROCESS_REGISTRY_KEY = Symbol.for("@onurpi/turn-fold/automatic-compactions");

function isRegistryStore(value: unknown): value is RegistryStore {
  return value instanceof Map;
}

function validAssociation(association: EphemeralCompactionAssociation): boolean {
  return (
    association.compactionEntryId.length > 0 &&
    Number.isFinite(association.timestamp) &&
    Number.isFinite(association.turnStartedAt)
  );
}

export class EphemeralCompactionRegistry {
  public constructor(private readonly store: RegistryStore = new Map()) {}

  public remember(sessionKey: string, association: EphemeralCompactionAssociation): void {
    if (sessionKey.length === 0 || !validAssociation(association)) return;
    let associations = this.store.get(sessionKey);
    if (!associations) {
      associations = new Map();
      this.store.set(sessionKey, associations);
    }
    associations.set(association.compactionEntryId, association);
  }

  public associationsFor(sessionKey: string): ReadonlyMap<string, EphemeralCompactionAssociation> {
    return new Map(this.store.get(sessionKey) ?? []);
  }

  public clear(): void {
    this.store.clear();
  }
}

function processStore(): RegistryStore {
  const existing: unknown = Reflect.get(globalThis, PROCESS_REGISTRY_KEY);
  if (isRegistryStore(existing)) return existing;
  const created: RegistryStore = new Map();
  Reflect.set(globalThis, PROCESS_REGISTRY_KEY, created);
  return created;
}

export function processCompactionRegistry(): EphemeralCompactionRegistry {
  return new EphemeralCompactionRegistry(processStore());
}

export function closeCompactionRegistry(
  registry: EphemeralCompactionRegistry,
  reason: "fork" | "new" | "quit" | "reload" | "resume",
): void {
  if (reason === "quit") registry.clear();
}
