import * as fs from "node:fs";
import * as path from "node:path";

/** Marker comment — MC replaces this file on every OpenCode spawn. */
export const OPENCODE_CONCOURSE_PLUGIN_MARKER = "@concourse-managed";

/** Env vars the host injects so a spawned agent can reach the MC hook API. */
export const CONCOURSE_AGENT_ENV_KEYS = ["CONCOURSE_TASK_ID", "CONCOURSE_API_URL", "CONCOURSE_API_TOKEN"] as const;

export const OPENCODE_CONCOURSE_PLUGIN_SEGMENTS = [
  ".opencode",
  "plugins",
  "concourse.js",
] as const;

export function opencodeConcoursePluginSource(): string {
  return `// ${OPENCODE_CONCOURSE_PLUGIN_MARKER}
/** Concourse status bridge for OpenCode (auto-installed). */

function sessionIdFrom(event) {
  const props = event?.properties ?? {};
  const info = props.info ?? {};
  return (
    props.sessionID ??
    props.sessionId ??
    info.sessionID ??
    info.sessionId ??
    info.id ??
    props.id ??
    props.session_id ??
    ""
  );
}

async function postConcourseHook(hookEventName, body = {}) {
  const taskId = process.env.CONCOURSE_TASK_ID;
  const apiUrl = process.env.CONCOURSE_API_URL;
  const token = process.env.CONCOURSE_API_TOKEN;
  if (!taskId || !apiUrl || !token) return;

  const url =
    apiUrl +
    "/api/hooks/opencode?taskId=" +
    encodeURIComponent(taskId) +
    "&hookEvent=" +
    encodeURIComponent(hookEventName);

  const payload = { hook_event_name: hookEventName, ...body };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Concourse-Runtime": "electron-local",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* fail-soft — never block the user's session */
  }
}

export const ConcourseStatus = async () => {
  return {
    "shell.env": async (_input, output) => {
      ${CONCOURSE_AGENT_ENV_KEYS.map(
        (key) => `if (process.env.${key}) output.env.${key} = process.env.${key};`,
      ).join("\n      ")}
    },
    "chat.message": async (input, output) => {
      if (output.message?.role !== "user") return;
      const prompt = output.parts
        ?.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\\n")
        .trim();
      await postConcourseHook("UserPromptSubmit", {
        session_id: input.sessionID,
        ...(prompt ? { prompt } : {}),
      });
    },
    "tool.execute.before": async (input) => {
      if (input.tool !== "question") return;
      void postConcourseHook(
        "QuestionRequest",
        input.sessionID ? { session_id: input.sessionID } : {},
      );
    },
    event: async ({ event }) => {
      if (!event?.type) return;

      if (event.type === "session.created") {
        const sessionId = sessionIdFrom(event);
        if (sessionId) {
          await postConcourseHook("SessionStart", { session_id: sessionId });
        }
        return;
      }

      if (event.type === "session.status") {
        const props = event.properties ?? {};
        const sessionId = sessionIdFrom(event);
        const statusType = props.status?.type;
        if (statusType === "idle") {
          await postConcourseHook("Stop", sessionId ? { session_id: sessionId } : {});
        }
        return;
      }

      if (event.type === "session.idle") {
        const sessionId = sessionIdFrom(event);
        await postConcourseHook("Stop", sessionId ? { session_id: sessionId } : {});
        return;
      }

      if (event.type === "question.asked") {
        const sessionId = sessionIdFrom(event);
        await postConcourseHook(
          "QuestionRequest",
          sessionId ? { session_id: sessionId } : {},
        );
        return;
      }

      if (event.type === "permission.asked") {
        const sessionId = sessionIdFrom(event);
        await postConcourseHook(
          "PermissionRequest",
          sessionId ? { session_id: sessionId } : {},
        );
      }
    },
  };
};
`;
}

export function opencodeConcoursePluginPath(cwd: string): string {
  return path.join(cwd, ...OPENCODE_CONCOURSE_PLUGIN_SEGMENTS);
}

export function writeOpencodeConcoursePlugin(cwd: string): void {
  const file = opencodeConcoursePluginPath(cwd);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, opencodeConcoursePluginSource(), "utf8");
  } catch {
    // best-effort — card status simply won't update if install fails
  }
}
