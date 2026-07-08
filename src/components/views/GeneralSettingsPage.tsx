import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { openExternal } from "~/lib/open-external";
import { toast } from "sonner";
import { Btn } from "~/components/ui/Btn";
import { Field, SettingsSection, ToggleRow } from "~/components/views/SettingsParts";
import { getElectron } from "~/lib/electron";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys, useSettings } from "~/queries";
import {
  CURRENT_CONCOURSE_VERSION,
  useLatestConcourseVersion,
} from "~/queries/concourse-version";
import {
  canTriggerUpdateCheck,
  triggerUpdateDownload,
  triggerUpdateCheck,
  triggerUpdateInstall,
  useAutoUpdaterState,
} from "~/queries/mc-auto-updater";
import { DEFAULT_ACCENT_COLOR } from "~/lib/accent-colors";
import { DEFAULT_TERMINAL_ZOOM_LEVEL } from "~/shared/terminal-zoom";
import {
  readOsNotificationPermission,
  requestOsNotificationPermission,
  type OsNotificationPermission,
} from "~/lib/os-notifications";
import { isElectron } from "~/lib/electron";
import { emptyVoiceCommandAliases } from "~/shared/voice-command-aliases";

export function GeneralSettingsPage() {
  const [exportingLogs, setExportingLogs] = useState(false);
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const mouseGradientEnabled = !(settings?.mouseGradientDisabled ?? false);
  const toastEnabled = settings?.sessionFinishToastEnabled ?? true;
  const osNotificationEnabled =
    settings?.sessionFinishOsNotificationEnabled ?? false;
  const notificationSoundEnabled = settings?.notificationSoundEnabled ?? true;
  const automaticUpdateDownloadsEnabled =
    settings?.automaticUpdateDownloadsEnabled ?? false;
  const automaticUpdateInstallOnQuitEnabled =
    settings?.automaticUpdateInstallOnQuitEnabled ?? false;
  const [permission, setPermission] = useState<OsNotificationPermission>("default");
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setPermission("unsupported");
      return;
    }
    const refreshPermission = () => {
      void readOsNotificationPermission().then(setPermission);
    };
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);

  const optimisticSettings = (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
      >
    >,
  ): AppSettings => ({
    agentSystemBannerDisabled: settings?.agentSystemBannerDisabled ?? false,
    accentColor: settings?.accentColor ?? DEFAULT_ACCENT_COLOR,
    minimalTheme: settings?.minimalTheme ?? false,
    mouseGradientDisabled: settings?.mouseGradientDisabled ?? false,
    sessionFinishToastEnabled: toastEnabled,
    sessionFinishOsNotificationEnabled: osNotificationEnabled,
    notificationSoundEnabled,
    automaticUpdateDownloadsEnabled,
    automaticUpdateInstallOnQuitEnabled,
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
    onboardingCompleted: settings?.onboardingCompleted ?? false,
    orgCurationEnabled: settings?.orgCurationEnabled ?? true,
    orgCurationLastRunAt: settings?.orgCurationLastRunAt ?? null,
    ...queryClient.getQueryData<AppSettings>(queryKeys.settings),
    worktreesEnabled:
      queryClient.getQueryData<AppSettings>(queryKeys.settings)?.worktreesEnabled ??
      settings?.worktreesEnabled ??
      false,
    ...patch,
  });

  const updateSettings = async (
    patch: Partial<
      Pick<
        AppSettings,
        | "agentSystemBannerDisabled"
        | "mouseGradientDisabled"
        | "sessionFinishToastEnabled"
        | "sessionFinishOsNotificationEnabled"
        | "notificationSoundEnabled"
        | "automaticUpdateDownloadsEnabled"
        | "automaticUpdateInstallOnQuitEnabled"
      >
    >,
  ) => {
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    const optimistic = optimisticSettings(patch);
    queryClient.setQueryData(queryKeys.settings, optimistic);
    try {
      const next = await api.updateSettings(patch);
      queryClient.setQueryData(queryKeys.settings, { ...optimistic, ...next });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKeys.settings, previous);
      throw error;
    }
  };

  const setMouseGradientEnabled = async (enabled: boolean) => {
    await updateSettings({ mouseGradientDisabled: !enabled });
  };

  const setToastEnabled = async (sessionFinishToastEnabled: boolean) => {
    await updateSettings({ sessionFinishToastEnabled });
  };

  const setNotificationSoundEnabled = async (enabled: boolean) => {
    await updateSettings({ notificationSoundEnabled: enabled });
  };

  const setAutomaticUpdateDownloadsEnabled = async (enabled: boolean) => {
    await updateSettings({ automaticUpdateDownloadsEnabled: enabled });
    if (enabled) {
      try {
        await triggerUpdateCheck();
      } catch (err) {
        console.error("[updater] check after enabling auto-download failed:", err);
      }
    }
  };

  const setAutomaticUpdateInstallOnQuitEnabled = async (enabled: boolean) => {
    await updateSettings({ automaticUpdateInstallOnQuitEnabled: enabled });
  };

  const setOsNotificationEnabled = async (enabled: boolean) => {
    setPermissionHint(null);
    if (enabled) {
      const current = await readOsNotificationPermission();
      setPermission(current);
      if (current === "unsupported") {
        setPermissionHint("OS notifications are not supported in this environment.");
        return;
      }
      if (!isElectron()) {
        if (current === "denied") {
          setPermissionHint(
            "Notification permission is blocked. Enable it in your OS or browser settings, then try again.",
          );
          return;
        }
        if (current === "default") {
          const result = await requestOsNotificationPermission();
          setPermission(result);
          if (result !== "granted") {
            setPermissionHint(
              "Notification permission was not granted. Enable it in your OS or browser settings, then try again.",
            );
            return;
          }
        }
      }
    }
    await updateSettings({
      sessionFinishOsNotificationEnabled: enabled,
    });
  };

  const osNotificationBlocked =
    osNotificationEnabled &&
    permission !== "unsupported" &&
    permission !== "granted";
  const osNotificationStatusMessage =
    permissionHint ??
    (osNotificationBlocked && permission === "denied" && !isElectron()
      ? "Notification permission is blocked. On macOS, open System Settings → Notifications → Concourse, allow notifications, then reload Concourse."
      : osNotificationBlocked && permission === "default" && !isElectron()
        ? "Notification permission is not granted yet. Turn this toggle off and on again to approve the prompt."
        : null);

  return (
    <>
      <SettingsSection
        title="General"
        subtitle="Control app-wide interface preferences."
        headingLevel="h1"
      >
        {/* AgentSystem.dev banner toggle hidden for now — the banner itself
            is also gated off in __root.tsx. */}
        <Field label="Mouse gradient">
          <ToggleRow
            title="Show mouse gradient"
            description="Cursor and card gradients follow the pointer across the workspace."
            checked={mouseGradientEnabled}
            onChange={setMouseGradientEnabled}
            label="Enable"
          />
        </Field>
        <Field label="Updates">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ToggleRow
              title="Download updates automatically"
              description="When enabled, Concourse downloads app updates in the background after a check finds one."
              checked={automaticUpdateDownloadsEnabled}
              onChange={setAutomaticUpdateDownloadsEnabled}
              label="Enable automatic update downloads"
            />
            <ToggleRow
              title="Install updates when quitting"
              description="When enabled, a downloaded update installs the next time you quit Concourse. Otherwise use Restart to install."
              checked={automaticUpdateInstallOnQuitEnabled}
              onChange={setAutomaticUpdateInstallOnQuitEnabled}
              label="Enable install on quit"
            />
          </div>
        </Field>
      </SettingsSection>
      <SettingsSection
        title="Troubleshooting"
        subtitle="Something broke? Export a support bundle and send it over."
      >
        <Field label="Logs">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55 }}>
              Concourse keeps a local log of errors from the app, its server, and AI sessions.
              The support bundle zips those logs plus version info to your Desktop — attach it
              when reporting a problem. Logs never include API keys or tokens.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn
                variant="primary"
                icon="download"
                disabled={exportingLogs}
                onClick={() => {
                  setExportingLogs(true);
                  void getElectron()
                    ?.logs.exportBundle()
                    .then((r) => {
                      if (r.ok) toast.success("Support bundle saved to your Desktop");
                      else toast.error(r.error || "Could not export the support bundle");
                    })
                    .catch((e) =>
                      toast.error(e instanceof Error ? e.message : "Could not export the support bundle"),
                    )
                    .finally(() => setExportingLogs(false));
                }}
              >
                {exportingLogs ? "Exporting…" : "Export support bundle"}
              </Btn>
              <Btn
                variant="ghost"
                icon="folder"
                onClick={() => void getElectron()?.logs.reveal()}
              >
                Reveal log file
              </Btn>
            </div>
          </div>
        </Field>
      </SettingsSection>
      <SettingsSection
        title="Session finish notifications"
        subtitle="Get notified when a Claude session finishes in any project."
      >
        <Field label="Sound">
          <ToggleRow
            title="Notification sound"
            description="Play a short ding when a session finishes or a diagram is ready."
            checked={notificationSoundEnabled}
            onChange={setNotificationSoundEnabled}
            label="Play sound"
          />
        </Field>
        <Field label="Toast">
          <ToggleRow
            title="Show toast"
            description="A toast appears in the bottom-right when a session finishes."
            checked={toastEnabled}
            onChange={setToastEnabled}
            label="Show toast"
          />
        </Field>
        <Field label="OS notification">
          <ToggleRow
            title="OS notification"
            description={
              permission === "unsupported"
                ? "Not supported in this environment."
                : isElectron()
                  ? "Uses macOS notifications through Electron. Control badges, sounds, and banners in System Settings → Notifications → Electron."
                  : "A native OS notification appears so you see it even when the app is in the background."
            }
            checked={osNotificationEnabled}
            onChange={setOsNotificationEnabled}
            disabled={permission === "unsupported"}
            label="Enable"
          />
          {osNotificationStatusMessage && (
            <div
              role="status"
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-dim)",
                lineHeight: 1.45,
              }}
            >
              {osNotificationStatusMessage}
            </div>
          )}
        </Field>
      </SettingsSection>
      <AboutSection />
      <ReloadSection />
    </>
  );
}

function AboutSection() {
  const { data: academy, isLoading: academyLoading, isError: academyError } =
    useLatestConcourseVersion();
  const updater = useAutoUpdaterState();
  const statusId = useId();
  const latest = academy?.latestVersion;
  const academyHasUpdate = !!academy?.isUpdateAvailable;

  const openBrowserDownload = () => {
    if (!academy?.downloadUrl) return;
    const api = (window as any).electronAPI;
    if (api?.openExternal) void api.openExternal(academy.downloadUrl);
    else openExternal(academy.downloadUrl);
  };

  let status: string;
  let action: { label: string; onClick: () => void } | null = null;
  const busy =
    updater.kind === "priming" ||
    updater.kind === "checking" ||
    updater.kind === "downloading";
  const checkForUpdate = async () => {
    try {
      await triggerUpdateCheck();
    } catch (err) {
      console.error("[updater] check failed; falling through to browser:", err);
      openBrowserDownload();
    }
  };
  const downloadUpdate = async () => {
    const res = await triggerUpdateDownload();
    if (!res.ok) {
      console.error("[updater] download failed:", res.error);
      if (academy?.downloadUrl) openBrowserDownload();
    }
  };

  switch (updater.kind) {
    case "priming":
      status = "Checking for updates…";
      break;
    case "checking":
      status = "Checking for updates…";
      break;
    case "available":
      status = `Update v${updater.version} found.`;
      action = { label: "Download", onClick: downloadUpdate };
      break;
    case "downloading": {
      const pct = Math.round(updater.percent);
      status =
        pct < 1
          ? `Starting download of v${updater.version}…`
          : `Downloading v${updater.version} — ${pct}%`;
      break;
    }
    case "ready-to-install":
      status = `v${updater.version} downloaded and ready to install.`;
      action = {
        label: "Restart to install",
        onClick: async () => {
          const res = await triggerUpdateInstall();
          if (!res.ok && academy?.downloadUrl) openBrowserDownload();
        },
      };
      break;
    case "error":
      if (academyHasUpdate && latest && academy?.downloadUrl) {
        status = `Automatic update hit a download error. New version v${latest} is available.`;
        action = {
          label: "Update",
          onClick: checkForUpdate,
        };
      } else {
        status = `Auto-update unavailable (${updater.message}).`;
        // Always offer a retry path so the user isn't stranded.
        action = { label: "Try again", onClick: () => void triggerUpdateCheck() };
      }
      break;
    case "unsupported-dev":
      if (academyHasUpdate && latest && academy?.downloadUrl) {
        status = `New version v${latest} can be downloaded manually.`;
        action = { label: "Download", onClick: openBrowserDownload };
        break;
      }
      if (academyLoading) status = "Checking for updates…";
      else if (academyError) status = "Couldn't check for updates.";
      else if (!latest) status = "No release information available.";
      else status = "You're on the latest version.";
      break;
    case "idle":
    default:
      if (academyLoading) status = "Checking for updates…";
      else if (academyError) status = "Couldn't check for updates.";
      else if (!latest) status = "No release information available.";
      else if (academyHasUpdate && canTriggerUpdateCheck(updater)) {
        status = `New version v${latest} available.`;
        action = {
          label: "Update",
          onClick: checkForUpdate,
        };
      } else status = "You're on the latest version.";
      break;
  }

  return (
    <SettingsSection title="About" subtitle="Version information for Concourse.">
      <Field label="Version">
        <div
          aria-busy={busy}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              Installed: v{CURRENT_CONCOURSE_VERSION}
            </div>
            <div
              id={statusId}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}
            >
              {status}
            </div>
          </div>
          {action && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={action.onClick}
              aria-describedby={statusId}
              style={{ flexShrink: 0 }}
            >
              {action.label}
            </Btn>
          )}
        </div>
      </Field>
    </SettingsSection>
  );
}

function ReloadSection() {
  const reload = () => {
    const electron = getElectron();
    if (electron) {
      void electron.reload();
      return;
    }
    if (typeof window === "undefined") return;
    window.location.reload();
  };

  return (
    <SettingsSection title="Reload" subtitle="Refresh the current Concourse window.">
      <Field label="Window">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 14px",
            background: "var(--surface-0)",
            border: "1px solid var(--border)",
            borderRadius: 7,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>
              Reload app
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45 }}>
              Applies fresh frontend code and reconnects to the local server.
            </div>
          </div>
          <Btn type="button" variant="solid" size="sm" icon="refresh" onClick={reload}>
            Reload
          </Btn>
        </div>
      </Field>
    </SettingsSection>
  );
}
