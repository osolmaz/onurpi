/** Where a mounted folder's data lives on the host. */
export type MountSource =
  | { readonly kind: "host"; readonly path: string }
  | { readonly kind: "volume"; readonly name: string };

export type SandboxRuntime = "docker" | "podman";

export const WORKSPACE_TARGET = "/sandbox/workspace";
export const CONFIG_TARGET = "/sandbox/config";
/** The owner's global `AGENTS.md`, read-only. Use `/sandbox/pi-agent` as `agentDir` in the sandbox. */
export const INSTRUCTIONS_TARGET = "/sandbox/pi-agent/AGENTS.md";

type Mount = {
  readonly type: "bind" | "volume" | "tmpfs";
  readonly source?: string;
  readonly target: string;
  readonly read_only: boolean;
};

export type SandboxMounts = {
  readonly workspace: MountSource;
  readonly config: MountSource;
  readonly instructions?: MountSource;
  /**
   * Workspace paths the sandbox must not see, such as a folder of secrets. A path that ends in `/`
   * is a folder and gets an empty tmpfs; any other path is a file and gets `/dev/null`.
   */
  readonly hide?: readonly string[];
};

function hidden(path: string): Mount {
  const relative = path.replace(/\/$/u, "");
  if (
    relative === "" ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error(`A hidden path must be relative to the workspace: ${path}`);
  }
  const target = `${WORKSPACE_TARGET}/${relative}`;
  return path.endsWith("/")
    ? { read_only: true, target, type: "tmpfs" }
    : { read_only: true, source: "/dev/null", target, type: "bind" };
}

function mount(source: MountSource, target: string, readOnly: boolean): Mount {
  if (source.kind === "host") {
    if (!source.path.startsWith("/"))
      throw new Error(`A host folder must be an absolute path: ${source.path}`);
    return { read_only: readOnly, source: source.path, target, type: "bind" };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(source.name)) {
    throw new Error(
      `A volume name may hold only letters, digits, '_', '.', and '-': ${source.name}`,
    );
  }
  return { read_only: readOnly, source: source.name, target, type: "volume" };
}

/** Reads `host:/abs/path` or `volume:name`. */
export function parseMountSource(value: string): MountSource {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  if (separator > 0 && kind === "host") return { kind: "host", path: rest };
  if (separator > 0 && kind === "volume") return { kind: "volume", name: rest };
  throw new Error(`A mount must be host:/absolute/path or volume:name, not ${value}`);
}

/**
 * Builds the value for `openshell sandbox create --driver-config-json`. The workspace is
 * read-write and the configuration folder is read-only. Host folders need the gateway settings
 * `enable_bind_mounts = true` and `allow_driver_config = true`; named volumes need neither.
 */
export function sandboxDriverConfig(
  runtime: SandboxRuntime,
  folders: SandboxMounts,
): Readonly<Record<string, { readonly mounts: readonly Mount[] }>> {
  const mounts = [
    mount(folders.workspace, WORKSPACE_TARGET, false),
    mount(folders.config, CONFIG_TARGET, true),
  ];
  if (folders.instructions !== undefined)
    mounts.push(mount(folders.instructions, INSTRUCTIONS_TARGET, true));
  for (const path of folders.hide ?? []) mounts.push(hidden(path));
  return { [runtime]: { mounts } };
}
