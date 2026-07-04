import { z } from "zod";
import {
  deleteSetting,
  getBooleanSetting,
  getSetting,
  setBooleanSetting,
  setSetting,
} from "../services/settings";
import {
  DEFAULT_ACCENT_COLOR,
  isAccentColorId,
  type AccentColorId,
} from "~/lib/accent-colors";
import {
  COMMIT_CLI_VALUES,
  isCommitCli,
  type CommitCli,
} from "~/shared/commit-cli";
import { ENGINE_IDS, isEngineId, type EngineId } from "~/shared/ai-providers";
import {
  GIT_DIFF_CHANGED_FILES_VIEWS,
  GIT_DIFF_CHANGED_FILES_WIDTH_MAX,
  GIT_DIFF_CHANGED_FILES_WIDTH_MIN,
  PROJECTS_DASHBOARD_VIEWS,
  normalizeGitDiffChangedFilesView,
  normalizeGitDiffChangedFilesWidth,
  normalizeProjectsDashboardView,
  normalizeSelectedWorktreeByProject,
} from "~/shared/ui-preferences";
import { safeJsonParse } from "~/shared/safe-json";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  TERMINAL_ZOOM_MAX,
  TERMINAL_ZOOM_MIN,
  normalizeTerminalZoomLevel,
} from "~/shared/terminal-zoom";
import {
  emptyVoiceCommandAliases,
  normalizeVoiceCommandAliases,
  type VoiceCommandAliases,
} from "~/shared/voice-command-aliases";
import { json, parseJsonBody } from "./_helpers";

const COMMIT_CLI_SETTING_KEY = "commit_cli";
const AI_PROVIDER_SETTING_KEY = "ai_provider";
const AI_MODEL_BY_PROVIDER_SETTING_KEY = "ai_model_by_provider";
const AI_CREDENTIAL_BY_PROVIDER_SETTING_KEY = "ai_credential_by_provider";
const AI_CUSTOM_BASE_URL_SETTING_KEY = "ai_custom_base_url";
// How each provider authenticates: its own CLI login vs a stored API key.
// Only the MODE lives here — key material stays in the OS keychain
// (electron/credentials/store.ts), never in sqlite.
const AI_CREDENTIAL_MODES = ["cli-login", "api-key"] as const;
type AiCredentialMode = (typeof AI_CREDENTIAL_MODES)[number];
const GIT_DIFF_CHANGED_FILES_VIEW_KEY = "git_diff_changed_files_view";
const GIT_DIFF_CHANGED_FILES_WIDTH_KEY = "git_diff_changed_files_width";
const SELECTED_WORKTREE_BY_PROJECT_KEY = "selected_worktree_by_project";
const PROJECTS_DASHBOARD_VIEW_KEY = "projects_dashboard_view";
const TERMINAL_ZOOM_LEVEL_KEY = "terminal_zoom_level";
const VOICE_COMMAND_ALIASES_KEY = "voice_command_aliases";

const voiceCommandAliasesBody = z.unknown().transform((value, ctx): VoiceCommandAliases => {
  try {
    return normalizeVoiceCommandAliases(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid voiceCommandAliases",
    });
    return z.NEVER;
  }
});

// The api bearer token is intentionally NOT delivered over HTTP. It is only
// readable through the Electron IPC channel `settings:getToken`, so a page
// cannot exfiltrate it via fetch even from the same origin. See
// todos/bugs/done/02-api-settings-leaks-bearer-token.md for the original leak.
// .strict() so a stale client that still sends the removed `regenerate: true`
// field (or any other unknown key) gets a 400 instead of a silent no-op.
const updateSettingsBody = z
  .strictObject({
    agentSystemBannerDisabled: z.boolean(),
    accentColor: z.string().refine(isAccentColorId, { message: "invalid accentColor" }),
    minimalTheme: z.boolean(),
    mouseGradientDisabled: z.boolean(),
    sessionFinishToastEnabled: z.boolean(),
    sessionFinishOsNotificationEnabled: z.boolean(),
    notificationSoundEnabled: z.boolean(),
    launchOverlayEnabled: z.boolean(),
    automaticUpdateDownloadsEnabled: z.boolean(),
    automaticUpdateInstallOnQuitEnabled: z.boolean(),
    worktreesEnabled: z.boolean(),
    projectTerminalsEnabled: z.boolean(),
    voiceControlEnabled: z.boolean(),
    gitDiffChangedFilesView: z.enum(GIT_DIFF_CHANGED_FILES_VIEWS).nullable(),
    gitDiffChangedFilesWidth: z
      .number()
      .int()
      .min(GIT_DIFF_CHANGED_FILES_WIDTH_MIN)
      .max(GIT_DIFF_CHANGED_FILES_WIDTH_MAX)
      .nullable(),
    projectsDashboardView: z.enum(PROJECTS_DASHBOARD_VIEWS).nullable(),
    selectedWorktreeByProject: z.record(z.string(), z.string()).nullable(),
    commitCli: z.union([z.enum(COMMIT_CLI_VALUES), z.null()]),
    terminalZoomLevel: z.number().int().min(TERMINAL_ZOOM_MIN).max(TERMINAL_ZOOM_MAX),
    aiProvider: z.enum(ENGINE_IDS),
    aiModelByProvider: z.record(z.string(), z.string()),
    aiCredentialByProvider: z.record(z.string(), z.enum(AI_CREDENTIAL_MODES)),
    aiCustomBaseUrl: z.string().max(500),
    voiceCommandAliases: voiceCommandAliasesBody,
  })
  .partial();

function getAccentColorSetting(): AccentColorId {
  const value = getSetting("accent_color");
  return isAccentColorId(value) ? value : DEFAULT_ACCENT_COLOR;
}

function getCommitCliSetting(): CommitCli | null {
  const value = getSetting(COMMIT_CLI_SETTING_KEY);
  return isCommitCli(value) ? value : null;
}

function getAiProviderSetting(): EngineId {
  const value = getSetting(AI_PROVIDER_SETTING_KEY);
  return isEngineId(value) ? value : "claude-code";
}

function getAiModelByProviderSetting(): Record<string, string> {
  const raw = safeJsonParse<unknown>(getSetting(AI_MODEL_BY_PROVIDER_SETTING_KEY), null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

function getAiCredentialByProviderSetting(): Record<string, AiCredentialMode> {
  const raw = safeJsonParse<unknown>(getSetting(AI_CREDENTIAL_BY_PROVIDER_SETTING_KEY), null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, AiCredentialMode> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (AI_CREDENTIAL_MODES.includes(value as AiCredentialMode)) {
      out[key] = value as AiCredentialMode;
    }
  }
  return out;
}

function getGitDiffChangedFilesViewSetting() {
  return normalizeGitDiffChangedFilesView(getSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY));
}

function getGitDiffChangedFilesWidthSetting() {
  return normalizeGitDiffChangedFilesWidth(getSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY));
}

function getProjectsDashboardViewSetting() {
  return normalizeProjectsDashboardView(getSetting(PROJECTS_DASHBOARD_VIEW_KEY));
}

function getSelectedWorktreeByProjectSetting() {
  const raw = getSetting(SELECTED_WORKTREE_BY_PROJECT_KEY);
  return normalizeSelectedWorktreeByProject(safeJsonParse<unknown>(raw, null));
}

function getTerminalZoomLevelSetting() {
  return normalizeTerminalZoomLevel(getSetting(TERMINAL_ZOOM_LEVEL_KEY)) ?? DEFAULT_TERMINAL_ZOOM_LEVEL;
}

function getVoiceCommandAliasesSetting() {
  const raw = getSetting(VOICE_COMMAND_ALIASES_KEY);
  try {
    return normalizeVoiceCommandAliases(safeJsonParse<unknown>(raw, null));
  } catch {
    return emptyVoiceCommandAliases();
  }
}

function settingsPayload() {
  return {
    agentSystemBannerDisabled: getBooleanSetting("agent_system_banner_disabled"),
    accentColor: getAccentColorSetting(),
    minimalTheme: getBooleanSetting("minimal_theme"),
    mouseGradientDisabled: getBooleanSetting("mouse_gradient_disabled"),
    sessionFinishToastEnabled: getBooleanSetting("session_finish_toast_enabled", true),
    sessionFinishOsNotificationEnabled: getBooleanSetting(
      "session_finish_os_notification_enabled",
      false,
    ),
    notificationSoundEnabled: getBooleanSetting("notification_sound_enabled", true),
    launchOverlayEnabled: getBooleanSetting("launch_overlay_enabled", false),
    automaticUpdateDownloadsEnabled: getBooleanSetting(
      "automatic_update_downloads_enabled",
      false,
    ),
    automaticUpdateInstallOnQuitEnabled: getBooleanSetting(
      "automatic_update_install_on_quit_enabled",
      false,
    ),
    worktreesEnabled: getBooleanSetting("worktrees_enabled", false),
    projectTerminalsEnabled: getBooleanSetting("project_terminals_enabled", true),
    voiceControlEnabled: getBooleanSetting("voice_control_enabled", false),
    gitDiffChangedFilesView: getGitDiffChangedFilesViewSetting(),
    gitDiffChangedFilesWidth: getGitDiffChangedFilesWidthSetting(),
    projectsDashboardView: getProjectsDashboardViewSetting(),
    selectedWorktreeByProject: getSelectedWorktreeByProjectSetting(),
    commitCli: getCommitCliSetting(),
    terminalZoomLevel: getTerminalZoomLevelSetting(),
    aiProvider: getAiProviderSetting(),
    aiModelByProvider: getAiModelByProviderSetting(),
    aiCredentialByProvider: getAiCredentialByProviderSetting(),
    aiCustomBaseUrl: getSetting(AI_CUSTOM_BASE_URL_SETTING_KEY) ?? "",
    voiceCommandAliases: getVoiceCommandAliasesSetting(),
  };
}

export function read(): Response {
  return json(settingsPayload());
}

export async function update(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, updateSettingsBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (body.agentSystemBannerDisabled !== undefined) {
    setBooleanSetting("agent_system_banner_disabled", body.agentSystemBannerDisabled);
  }
  if (body.accentColor !== undefined) {
    setSetting("accent_color", body.accentColor);
  }
  if (body.minimalTheme !== undefined) {
    setBooleanSetting("minimal_theme", body.minimalTheme);
  }
  if (body.mouseGradientDisabled !== undefined) {
    setBooleanSetting("mouse_gradient_disabled", body.mouseGradientDisabled);
  }
  if (body.sessionFinishToastEnabled !== undefined) {
    setBooleanSetting("session_finish_toast_enabled", body.sessionFinishToastEnabled);
  }
  if (body.sessionFinishOsNotificationEnabled !== undefined) {
    setBooleanSetting(
      "session_finish_os_notification_enabled",
      body.sessionFinishOsNotificationEnabled,
    );
  }
  if (body.notificationSoundEnabled !== undefined) {
    setBooleanSetting("notification_sound_enabled", body.notificationSoundEnabled);
  }
  if (body.launchOverlayEnabled !== undefined) {
    setBooleanSetting("launch_overlay_enabled", body.launchOverlayEnabled);
  }
  if (body.automaticUpdateDownloadsEnabled !== undefined) {
    setBooleanSetting(
      "automatic_update_downloads_enabled",
      body.automaticUpdateDownloadsEnabled,
    );
  }
  if (body.automaticUpdateInstallOnQuitEnabled !== undefined) {
    setBooleanSetting(
      "automatic_update_install_on_quit_enabled",
      body.automaticUpdateInstallOnQuitEnabled,
    );
  }
  if (body.worktreesEnabled !== undefined) {
    setBooleanSetting("worktrees_enabled", body.worktreesEnabled);
  }
  if (body.projectTerminalsEnabled !== undefined) {
    setBooleanSetting("project_terminals_enabled", body.projectTerminalsEnabled);
  }
  if (body.voiceControlEnabled !== undefined) {
    setBooleanSetting("voice_control_enabled", body.voiceControlEnabled);
  }
  if (body.gitDiffChangedFilesView !== undefined) {
    if (body.gitDiffChangedFilesView === null) {
      deleteSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY);
    } else {
      setSetting(GIT_DIFF_CHANGED_FILES_VIEW_KEY, body.gitDiffChangedFilesView);
    }
  }
  if (body.gitDiffChangedFilesWidth !== undefined) {
    if (body.gitDiffChangedFilesWidth === null) {
      deleteSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY);
    } else {
      setSetting(GIT_DIFF_CHANGED_FILES_WIDTH_KEY, String(body.gitDiffChangedFilesWidth));
    }
  }
  if (body.projectsDashboardView !== undefined) {
    if (body.projectsDashboardView === null) {
      deleteSetting(PROJECTS_DASHBOARD_VIEW_KEY);
    } else {
      setSetting(PROJECTS_DASHBOARD_VIEW_KEY, body.projectsDashboardView);
    }
  }
  if (body.selectedWorktreeByProject !== undefined) {
    if (body.selectedWorktreeByProject === null) {
      deleteSetting(SELECTED_WORKTREE_BY_PROJECT_KEY);
    } else {
      setSetting(
        SELECTED_WORKTREE_BY_PROJECT_KEY,
        JSON.stringify(body.selectedWorktreeByProject),
      );
    }
  }
  if (body.commitCli !== undefined) {
    if (body.commitCli === null) {
      deleteSetting(COMMIT_CLI_SETTING_KEY);
    } else {
      setSetting(COMMIT_CLI_SETTING_KEY, body.commitCli);
    }
  }
  if (body.terminalZoomLevel !== undefined) {
    setSetting(TERMINAL_ZOOM_LEVEL_KEY, String(body.terminalZoomLevel));
  }
  if (body.aiProvider !== undefined) {
    setSetting(AI_PROVIDER_SETTING_KEY, body.aiProvider);
  }
  if (body.aiModelByProvider !== undefined) {
    setSetting(AI_MODEL_BY_PROVIDER_SETTING_KEY, JSON.stringify(body.aiModelByProvider));
  }
  if (body.aiCredentialByProvider !== undefined) {
    setSetting(
      AI_CREDENTIAL_BY_PROVIDER_SETTING_KEY,
      JSON.stringify(body.aiCredentialByProvider),
    );
  }
  if (body.aiCustomBaseUrl !== undefined) {
    setSetting(AI_CUSTOM_BASE_URL_SETTING_KEY, body.aiCustomBaseUrl.trim());
  }
  if (body.voiceCommandAliases !== undefined) {
    setSetting(VOICE_COMMAND_ALIASES_KEY, JSON.stringify(body.voiceCommandAliases));
  }
  return json(settingsPayload());
}

/** Used by the commit service to read the persisted CLI choice without an HTTP round-trip. */
export function readCommitCliSetting(): CommitCli | null {
  return getCommitCliSetting();
}

/** Persist a CLI choice from the server side (used when auto-detection seeds a value). */
export function writeCommitCliSetting(cli: CommitCli): void {
  setSetting(COMMIT_CLI_SETTING_KEY, cli);
}
