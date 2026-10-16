const SUMMARY_MAX_CHARS = 4_000;

export function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function boundSummary(
  stdout: string,
  stderr: string,
): { summary: string; truncated: boolean } {
  const parts: string[] = [];
  if (stderr.trim()) {
    parts.push(`stderr:\n${stderr.trim()}`);
  }
  if (stdout.trim()) {
    parts.push(`stdout:\n${stdout.trim()}`);
  }
  const combined = parts.join("\n") || "(no output)";
  if (combined.length <= SUMMARY_MAX_CHARS) {
    return { summary: combined, truncated: false };
  }
  return {
    summary: `[output truncated, showing last ${SUMMARY_MAX_CHARS} chars]\n...${combined.slice(-SUMMARY_MAX_CHARS)}`,
    truncated: true,
  };
}

interface GateOutcome {
  timedOut: boolean;
  ok: boolean;
  timeoutMs: number;
  onPass: string;
  onFail: string;
}

export function gateNextAction(outcome: GateOutcome): string {
  if (outcome.timedOut) {
    return [
      `The gate timed out after ${Math.round(outcome.timeoutMs / 1000)}s; inspect the bounded output,`,
      "repair any actionable diagnostic, then re-run this JST gate once.",
    ].join(" ");
  }
  return outcome.ok ? outcome.onPass : outcome.onFail;
}
