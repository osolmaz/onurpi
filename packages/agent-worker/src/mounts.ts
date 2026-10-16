/** Where a mounted folder's data lives on the host. */
export type MountSource =
  | { readonly kind: "host"; readonly path: string }
  | { readonly kind: "volume"; readonly name: string };

export type SandboxRuntime = "docker" | "podman";

export const WORKSPACE_TARGET = "/sandbox/workspace";
export const CONFIG_TARGET = "/sandbox/config";

type Mount = {
  readonly type: "bind" | "volume";
  readonly source: string;
  readonly target: string;
  readonly read_only: boolean;
};

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
  workspace: MountSource,
  config: MountSource,
): Readonly<Record<string, { readonly mounts: readonly Mount[] }>> {
  return {
    [runtime]: {
      mounts: [mount(workspace, WORKSPACE_TARGET, false), mount(config, CONFIG_TARGET, true)],
    },
  };
}
