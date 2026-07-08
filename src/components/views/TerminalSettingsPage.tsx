import { useQueryClient } from "@tanstack/react-query";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import { TERMINAL_FONT_SIZE } from "~/lib/terminal-options";
import {
  DEFAULT_TERMINAL_ZOOM_LEVEL,
  TERMINAL_ZOOM_LABELS,
  TERMINAL_ZOOM_LEVELS,
  TERMINAL_ZOOM_MAX,
  TERMINAL_ZOOM_MIN,
  terminalFontSizeForLevel,
  type TerminalZoomLevel,
} from "~/shared/terminal-zoom";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";

export function TerminalSettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const level = settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL;
  const fontSize = terminalFontSizeForLevel(level);

  const optimisticSettings = (
    patch: Partial<AppSettings>,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    minimalTheme: settings?.minimalTheme ?? false,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    notificationSoundEnabled: settings?.notificationSoundEnabled ?? true,
    automaticUpdateDownloadsEnabled: settings?.automaticUpdateDownloadsEnabled ?? false,
    automaticUpdateInstallOnQuitEnabled:
      settings?.automaticUpdateInstallOnQuitEnabled ?? false,
    worktreesEnabled: settings?.worktreesEnabled ?? false,
    projectTerminalsEnabled: settings?.projectTerminalsEnabled ?? true,
    onboardingCompleted: settings?.onboardingCompleted ?? false,
    orgCurationEnabled: settings?.orgCurationEnabled ?? true,
    orgCurationLastRunAt: settings?.orgCurationLastRunAt ?? null,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    projectsDashboardView: settings?.projectsDashboardView ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    terminalZoomLevel: level,
    aiProvider: settings?.aiProvider ?? "claude-code",
    aiModelByProvider: settings?.aiModelByProvider ?? {},
    aiCredentialByProvider: settings?.aiCredentialByProvider ?? {},
    aiCustomBaseUrl: settings?.aiCustomBaseUrl ?? "",
    voiceCommandAliases: settings?.voiceCommandAliases ?? emptyVoiceCommandAliases(),
    voiceControlEnabled: settings?.voiceControlEnabled ?? false,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    ...patch,
  });

  const setLevel = async (next: TerminalZoomLevel) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ terminalZoomLevel: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ terminalZoomLevel: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const projectTerminalsEnabled = settings?.projectTerminalsEnabled ?? true;
  const setProjectTerminals = async (next: boolean) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ projectTerminalsEnabled: next });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const updated = await api.updateSettings({ projectTerminalsEnabled: next });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...updated });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Terminal"
      subtitle="Default text size for new terminals and sessions without a per-pane override."
      headingLevel="h1"
    >
      <Field label="Default zoom">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 420 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.55,
            }}
          >
            Applies to every terminal until you zoom that pane in or out from its header.
            Per-pane zoom is remembered separately.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--text)",
            }}
          >
            <span>{TERMINAL_ZOOM_LABELS[level]}</span>
            <span style={{ color: "var(--text-dim)" }}>{fontSize}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={TERMINAL_ZOOM_LEVELS.length - 1}
            step={1}
            value={TERMINAL_ZOOM_LEVELS.indexOf(level)}
            onChange={(event) => {
              const index = Number(event.currentTarget.value);
              const next = TERMINAL_ZOOM_LEVELS[index];
              if (next !== undefined) void setLevel(next);
            }}
            aria-label="Default terminal zoom level"
            aria-valuemin={TERMINAL_ZOOM_MIN}
            aria-valuemax={TERMINAL_ZOOM_MAX}
            aria-valuenow={level}
            aria-valuetext={TERMINAL_ZOOM_LABELS[level]}
            style={{
              width: "100%",
              accentColor: "var(--accent)",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--text-faint)",
            }}
          >
            {TERMINAL_ZOOM_LEVELS.map((step) => (
              <span key={step}>{step > 0 ? `+${step}` : step}</span>
            ))}
          </div>
          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--terminal-bg)",
              fontFamily: "var(--mono)",
              fontSize,
              color: "var(--text)",
              lineHeight: 1.4,
            }}
            aria-hidden
          >
            $ concourse — preview at {fontSize}px (base {TERMINAL_FONT_SIZE}px)
          </div>
        </div>
      </Field>

      <div style={{ marginTop: 20 }}>
        <ToggleRow
          title="Project Terminals panel"
          description="Show the terminal drawer at the bottom of a project. Handy for engineers; business workspaces can turn it off for a cleaner, no-terminal view."
          label="Project Terminals panel"
          checked={projectTerminalsEnabled}
          onChange={(next) => void setProjectTerminals(next)}
        />
      </div>
    </SettingsSection>
  );
}
