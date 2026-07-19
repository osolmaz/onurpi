import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommitTrailers,
  createCommitHookDirectory,
  removeCommitHookDirectory,
  wrapBashWithCommitAttribution,
} from "./git-commit-trailers.ts";

const MODEL_NAME = "Model O'Clock";
const OTHER_MODEL_NAME = "Other Model";
const PI_VERSION = "0.80.10";
const CO_AUTHOR = `Co-Authored-By: ${MODEL_NAME} <noreply@pi.dev>`;
const GENERATED_BY = `Generated-By: pi ${PI_VERSION}`;

type GitRepo = {
  cleanup: () => void;
  cwd: string;
  hooksDirectory: string;
  run: (script: string, modelName?: string) => string;
};

function createIsolatedGitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith("PI_MUST_WIN_") || /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) {
      Reflect.deleteProperty(environment, key);
    }
  }
  return environment;
}

function createGitRepo(): GitRepo {
  const cwd = mkdtempSync(join(tmpdir(), "pi-must-win-test-"));
  const hooksDirectory = createCommitHookDirectory();
  execFileSync(
    "bash",
    [
      "-lc",
      "set -euo pipefail\ngit init -q\ngit config user.name Tester\ngit config user.email tester@example.com",
    ],
    { cwd, env: createIsolatedGitEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );

  const repo: GitRepo = {
    cwd,
    hooksDirectory,
    run(script, modelName = MODEL_NAME) {
      const wrapped = wrapBashWithCommitAttribution(
        script,
        repo.hooksDirectory,
        modelName,
        PI_VERSION,
      );
      return execFileSync("bash", ["-lc", `set -euo pipefail\n${wrapped}`], {
        cwd,
        encoding: "utf8",
        env: createIsolatedGitEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    cleanup() {
      removeCommitHookDirectory(repo.hooksDirectory);
      rmSync(cwd, { force: true, recursive: true });
    },
  };
  return repo;
}

function withGitRepo<T>(run: (repo: GitRepo) => T): T {
  const repo = createGitRepo();
  try {
    return run(repo);
  } finally {
    repo.cleanup();
  }
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Pi Git commit trailers", () => {
  it("adds attribution without modifying repository hook configuration", () => {
    withGitRepo((repo) => {
      const output = repo.run(`
echo one > a.txt
git add a.txt
git commit -q -m 'simple subject'
git config --local --get core.hooksPath || true
test ! -f .git/hooks/prepare-commit-msg
git log -1 --format=%B
`);

      expect(output).toContain("simple subject");
      expect(output).toContain(CO_AUTHOR);
      expect(output).toContain(GENERATED_BY);
      expect(existsSync(join(repo.cwd, ".git/hooks/prepare-commit-msg"))).toBe(false);
    });
  });

  it("supports common Git invocation and message forms without duplicate trailers", () => {
    withGitRepo((repo) => {
      const output = repo.run(`
echo one > a.txt
git add a.txt
git commit -q -m 'plain subject'
echo two > b.txt
git add b.txt
"$(command -v git)" commit -q -m 'absolute subject'
echo three > c.txt
command git add c.txt
sh -c 'git commit -q -m "nested subject" c.txt'
echo four > message.txt
cat > commit-message.txt <<'EOF'
file subject

file body
EOF
git add message.txt
git commit -q -F commit-message.txt
echo amended >> message.txt
git add message.txt
git commit -q --amend --no-edit
git log --format=%B --max-count=4
`);

      expect(output).toContain("plain subject");
      expect(output).toContain("absolute subject");
      expect(output).toContain("nested subject");
      expect(output).toContain("file body");
      expect(countOccurrences(output, CO_AUTHOR)).toBe(4);
      expect(countOccurrences(output, GENERATED_BY)).toBe(4);
    });
  });

  it("chains default, absolute, and relative user hooks", () => {
    withGitRepo((repo) => {
      const defaultHook = join(repo.cwd, ".git/hooks/prepare-commit-msg");
      writeFileSync(defaultHook, '#!/bin/sh\nprintf "\\nUser-Hook: default\\n" >> "$1"\n', {
        mode: 0o755,
      });
      const defaultOutput = repo.run(
        "echo one > a; git add a; git commit -q -m default; git log -1 --format=%B",
      );
      expect(defaultOutput).toContain("User-Hook: default");

      const absoluteHooks = join(repo.cwd, "absolute-hooks");
      mkdirSync(absoluteHooks);
      writeFileSync(
        join(absoluteHooks, "prepare-commit-msg"),
        '#!/bin/sh\nprintf "\\nUser-Hook: absolute\\n" >> "$1"\n',
        { mode: 0o755 },
      );
      const absoluteOutput = repo.run(
        `git config core.hooksPath '${absoluteHooks}'; echo two > b; git add b; git commit -q -m absolute; git log -1 --format=%B`,
      );
      expect(absoluteOutput).toContain("User-Hook: absolute");

      const relativeHooks = join(repo.cwd, "relative-hooks");
      mkdirSync(relativeHooks);
      writeFileSync(
        join(relativeHooks, "prepare-commit-msg"),
        '#!/bin/sh\nprintf "\\nUser-Hook: relative\\n" >> "$1"\n',
        { mode: 0o755 },
      );
      const relativeOutput = repo.run(
        "git config core.hooksPath relative-hooks; echo three > c; git add c; git commit -q -m relative; git log -1 --format=%B",
      );
      expect(relativeOutput).toContain("User-Hook: relative");
      expect(relativeOutput).toContain(CO_AUTHOR);
    });
  });

  it("propagates an existing hook failure", () => {
    withGitRepo((repo) => {
      writeFileSync(join(repo.cwd, ".git/hooks/prepare-commit-msg"), "#!/bin/sh\nexit 42\n", {
        mode: 0o755,
      });

      expect(() => repo.run("echo one > a; git add a; git commit -q -m blocked")).toThrow();
    });
  });

  it("quotes shell metacharacters in the temporary hook path", () => {
    withGitRepo((repo) => {
      const unusualDirectory = repo.hooksDirectory + '-\\"$`';
      renameSync(repo.hooksDirectory, unusualDirectory);
      repo.hooksDirectory = unusualDirectory;

      const output = repo.run(
        "echo one > a; git add a; git commit -q -m quoted; git log -1 --format=%B",
      );
      expect(output).toContain(CO_AUTHOR);
    });
  });

  it("uses the active model on each commit and sanitizes trailer values", () => {
    withGitRepo((repo) => {
      repo.run("echo one > a; git add a; git commit -q -m first");
      const output = repo.run(
        "echo two > b; git add b; git commit -q -m second; git log --format=%B --max-count=2",
        OTHER_MODEL_NAME,
      );

      expect(output).toContain(CO_AUTHOR);
      expect(output).toContain(`Co-Authored-By: ${OTHER_MODEL_NAME} <noreply@pi.dev>`);
    });

    expect(buildCommitTrailers("Bad\n<Model>", "\n")).toEqual({
      coAuthor: "Co-Authored-By: Bad Model <noreply@pi.dev>",
      generatedBy: "Generated-By: pi unknown",
    });
    expect(buildCommitTrailers("Bad\u0000Model", "1").coAuthor).toContain("Bad Model");
    expect(buildCommitTrailers("", "1").coAuthor).toContain("unknown");
  });

  it("removes an already-missing hook directory without failing", () => {
    const hooksDirectory = createCommitHookDirectory();
    removeCommitHookDirectory(hooksDirectory);
    expect(() => {
      removeCommitHookDirectory(hooksDirectory);
    }).not.toThrow();
  });
});
