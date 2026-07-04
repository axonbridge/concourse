import { spawn } from "node:child_process";

// Shared plumbing for CLI harnesses that speak JSONL over stdout per turn
// (Codex `exec --json`, Cursor `cursor-agent --output-format stream-json`).
// One process per TURN; multi-turn continuity comes from the vendor's own
// resume/thread id captured from the first turn's events.

export type JsonlTurn = {
  /** Resolves when the process exits. Rejects on spawn failure/non-zero exit. */
  done: Promise<void>;
  kill: () => void;
};

export function runJsonlTurn(
  command: string,
  args: string[],
  cwd: string,
  onEvent: (ev: any) => void,
  onStderr?: (line: string) => void,
): JsonlTurn {
  const proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* non-JSON line (banner, warning) — ignore */
      }
    }
  });
  if (onStderr) {
    proc.stderr.on("data", (c: Buffer) => onStderr(c.toString()));
  }
  const done = new Promise<void>((resolve, reject) => {
    proc.on("error", (e) =>
      reject(
        new Error(
          /ENOENT/.test(String(e))
            ? `${command} is not installed (not found on PATH).`
            : `${command}: ${e.message}`,
        ),
      ),
    );
    proc.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
  return { done, kill: () => proc.kill("SIGTERM") };
}
