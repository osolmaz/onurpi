import {
  createCommitHookDirectory,
  removeCommitHookDirectory,
  wrapBashWithCommitAttribution,
} from "../git-commit-trailers.ts";

export class CommitAttributionSession {
  private hooksDirectory: string | undefined;

  start(): string {
    this.hooksDirectory ??= createCommitHookDirectory();
    return this.hooksDirectory;
  }

  stop(): void {
    removeCommitHookDirectory(this.hooksDirectory);
    this.hooksDirectory = undefined;
  }

  wrap(command: string, modelName: string, piVersion: string): string {
    return wrapBashWithCommitAttribution(command, this.start(), modelName, piVersion);
  }
}
