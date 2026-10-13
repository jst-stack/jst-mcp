/** Application-level ports. Infrastructure adapters implement these; nothing above depends on Node directly. */

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandRunner {
  run(command: string, args: string[], options: { cwd: string; timeoutMs?: number }): Promise<CommandResult>;
}

export interface ProjectAccess {
  readPackageJson(root: string): Promise<unknown>;
  isDirectory(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
}
