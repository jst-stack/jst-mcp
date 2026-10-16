import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandResult, CommandRunner, ProjectAccess } from "../application/ports.js";

const MAX_CAPTURE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const SIGKILL_GRACE_MS = 1_000;

function appendBounded(accumulator: string, chunk: Buffer, limit: number): string {
  const next = accumulator + chunk.toString("utf8");
  return next.length > limit ? next.slice(-limit) : next;
}

export class SpawnCommandRunner implements CommandRunner {
  async run(command: string, args: string[], options: { cwd: string; timeoutMs?: number }): Promise<CommandResult> {
    const { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    return new Promise((resolvePromise, reject) => {
      // Argument-array spawn: never a shell, never string interpolation.
      const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout?.on("data", (data: Buffer) => {
        stdout = appendBounded(stdout, data, MAX_CAPTURE_BYTES);
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr = appendBounded(stderr, data, MAX_CAPTURE_BYTES);
      });

      let killTimer: ReturnType<typeof setTimeout> | undefined;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, SIGKILL_GRACE_MS);
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
      };
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code) => {
        cleanup();
        resolvePromise({ exitCode: code, stdout, stderr, timedOut });
      });
    });
  }
}

export class NodeProjectAccess implements ProjectAccess {
  async readPackageJson(root: string): Promise<unknown> {
    const raw = await readFile(resolve(root, "package.json"), "utf8");
    return JSON.parse(raw) as unknown;
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(path, "utf8");
  }
}

export interface DefaultPorts {
  runner: CommandRunner;
  project: ProjectAccess;
  cwd: string;
}

export function createDefaultPorts(cwd: string = process.cwd()): DefaultPorts {
  return { runner: new SpawnCommandRunner(), project: new NodeProjectAccess(), cwd };
}
