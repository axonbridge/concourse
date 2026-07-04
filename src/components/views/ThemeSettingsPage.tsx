import { useId } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "~/components/ui/Icon";
import { Field, SettingsSection } from "~/components/views/SettingsParts";
import {
  ACCENT_COLORS,
  applyAccentColor,
  DEFAULT_ACCENT_COLOR,
  type AccentColor,
  type AccentColorId,
} from "~/lib/accent-colors";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  hasCachedLaunchIntroPreference,
  readCachedLaunchIntroEnabled,
} from "~/lib/launch-intro";
import { DEFAULT_TERMINAL_ZOOM_LEVEL } from "~/shared/terminal-zoom";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";
import { useTheme } from "~/lib/use-theme";

// Pixel size of the color-swatch dot used in the accent-color picker (both
// the selected-check badge and the per-row preview swatch use this size).
const SWATCH_DOT_PX = 18;

export function ThemeSettingsPage() {
  const queryClient = useQueryClient();
  const { theme, set: setTheme } = useTheme();
  const { data: settings } = useSettings();
  const accentColor = settings?.accentColor ?? DEFAULT_ACCENT_COLOR;
  const minimalTheme = settings?.minimalTheme ?? false;
  const launchOverlayEnabled = typeof settings?.launchOverlayEnabled === "boolean"
    ? settings.launchOverlayEnabled
    : hasCachedLaunchIntroPreference()
      ? readCachedLaunchIntroEnabled()
      : false;

  const optimisticSettings = (
    patch: Partial<Pick<AppSettings, "accentColor" | "minimalTheme">>,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor,
    minimalTheme,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: settings?.sessionFinishToastEnabled ?? true,
    sessionFinishOsNotificationEnabled:
      settings?.sessionFinishOsNotificationEnabled ?? false,
    notificationSoundEnabled: settings?.notificationSoundEnabled ?? true,
    launchOverlayEnabled,
    automaticUpdateDownloadsEnabled:
      settings?.automaticUpdateDownloadsEnabled ?? false,
    automaticUpdateInstallOnQuitEnabled:
      settings?.automaticUpdateInstallOnQuitEnabled ?? false,
    gitDiffChangedFilesView: settings?.gitDiffChangedFilesView ?? null,
    gitDiffChangedFilesWidth: settings?.gitDiffChangedFilesWidth ?? null,
    projectsDashboardView: settings?.projectsDashboardView ?? null,
    selectedWorktreeByProject: settings?.selectedWorktreeByProject ?? null,
    commitCli: settings?.commitCli ?? null,
    terminalZoomLevel: settings?.terminalZoomLevel ?? DEFAULT_TERMINAL_ZOOM_LEVEL,
    aiProvider: settings?.aiProvider ?? "claude-code",
    aiModelByProvider: settings?.aiModelByProvider ?? {},
    aiCredentialByProvider: settings?.aiCredentialByProvider ?? {},
    aiCustomBaseUrl: settings?.aiCustomBaseUrl ?? "",
    voiceCommandAliases: settings?.voiceCommandAliases ?? emptyVoiceCommandAliases(),
    voiceControlEnabled: settings?.voiceControlEnabled ?? false,
    projectTerminalsEnabled: settings?.projectTerminalsEnabled ?? true,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled:
      queryClient.getQueryData<AppSettings>(queryKeys.settings)?.worktreesEnabled ??
      settings?.worktreesEnabled ??
      false,
    ...patch,
  });

  const setAccentColor = async (nextAccentColor: AccentColorId) => {
    applyAccentColor(nextAccentColor);
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings({ accentColor: nextAccentColor });
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const next = await api.updateSettings({ accentColor: nextAccentColor });
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...next });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  return (
    <SettingsSection
      title="Theme"
      subtitle="Choose your appearance and accent color."
      headingLevel="h1"
    >
      <Field label="Appearance">
        <div
          role="radiogroup"
          aria-label="Appearance"
          style={{
            display: "inline-flex",
            padding: 2,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: "var(--mm-radius, 7px)",
          }}
        >
          <ModeOption label="Dark" selected={theme === "dark"} onSelect={() => setTheme("dark")} />
          <ModeOption label="Light" selected={theme === "light"} onSelect={() => setTheme("light")} />
        </div>
      </Field>
      <Field label="Accent color">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(196px, 1fr))",
            gap: 14,
          }}
        >
          {ACCENT_COLORS.map((color) => (
            <MinimalThemeCard
              key={color.id}
              color={color}
              selected={color.id === accentColor}
              onSelect={() => setAccentColor(color.id)}
            />
          ))}
        </div>
      </Field>
    </SettingsSection>
  );
}

function ModeOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      style={{
        padding: "6px 12px",
        fontFamily: "var(--mono)",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        border: 0,
        borderRadius: "var(--mm-radius-sm, 5px)",
        cursor: "pointer",
        background: selected ? "var(--accent-dim)" : "transparent",
        color: selected ? "var(--accent)" : "var(--text-dim)",
        transition: "background 0.12s ease, color 0.12s ease",
      }}
    >
      {label}
    </button>
  );
}

function MinimalThemeCard({
  color,
  selected,
  onSelect,
}: {
  color: AccentColor;
  selected: boolean;
  onSelect: () => void;
}) {
  const accentRgba = (a: number) => `rgba(${color.rgb}, ${a})`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={color.name}
      style={{
        position: "relative",
        boxSizing: "border-box",
        padding: 14,
        cursor: "pointer",
        textAlign: "left",
        background: "var(--surface-1)",
        border: `1px solid ${selected ? color.value : "var(--border)"}`,
        borderRadius: "var(--mm-radius-lg, 10px)",
        boxShadow: selected ? `0 0 0 1px ${color.value} inset` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      {selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: SWATCH_DOT_PX,
            height: SWATCH_DOT_PX,
            borderRadius: 999,
            background: color.value,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={11} />
        </span>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: SWATCH_DOT_PX,
              height: SWATCH_DOT_PX,
              borderRadius: 999,
              background: color.value,
              border: "1px solid rgba(255, 255, 255, 0.15)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              fontWeight: 600,
              color: selected ? "var(--text)" : "var(--text-dim)",
              letterSpacing: "-0.01em",
            }}
          >
            {color.name}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "#fff",
              borderRadius: "var(--mm-radius-sm, 5px)",
              background: color.value,
            }}
          >
            Action
          </span>
          <span
            aria-hidden
            style={{
              flex: 1,
              height: 4,
              borderRadius: "var(--mm-radius-sm, 2px)",
              background: `linear-gradient(90deg, ${color.value}, ${accentRgba(0)})`,
              opacity: selected ? 1 : 0.6,
            }}
          />
        </div>
      </div>
    </button>
  );
}
