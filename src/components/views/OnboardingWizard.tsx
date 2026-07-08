import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "~/components/ui/Btn";
import { CardFrame } from "~/components/ui/CardFrame";
import { Icon, type IconName } from "~/components/ui/Icon";
import { api, type AppSettings } from "~/lib/api";
import { queryKeys } from "~/queries";
import { AiSettingsPage } from "./AiSettingsPage";
import { GitSettingsPage } from "./GitSettingsPage";
import { IntegrationsSettingsPage } from "./IntegrationsSettingsPage";
import { ThemeSettingsPage } from "./ThemeSettingsPage";

// First-run setup wizard. Gated on AppSettings.onboardingCompleted in Shell:
// it shows every launch until the last step is completed (no skip). Every step
// embeds the corresponding Settings page, so everything set here is editable
// later under Settings.
const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "ai", label: "AI provider" },
  { id: "git", label: "Git" },
  { id: "integrations", label: "Integrations" },
  { id: "theme", label: "Theme" },
] as const;

export function OnboardingWizard() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const isLast = step === STEPS.length - 1;

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    // Optimistically flip the flag — the Shell gate unmounts the wizard the
    // moment the settings cache updates.
    const previous = queryClient.getQueryData<AppSettings>(queryKeys.settings);
    if (previous) {
      queryClient.setQueryData(queryKeys.settings, { ...previous, onboardingCompleted: true });
    }
    try {
      await api.updateSettings({ onboardingCompleted: true });
    } catch {
      // Persist failed (offline?) — leave the wizard dismissed for this
      // session; it will show again next launch, which is the safe default.
    } finally {
      setSaving(false);
    }
  };

  const current = STEPS[step]!;

  return (
    <div
      data-navigation-swipe-blocker
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <CardFrame
        style={{
          width: "min(860px, calc(100vw - 48px))",
          height: "min(680px, calc(100vh - 64px))",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--bg)",
        }}
      >
        {/* Header: brand + step trail */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <img src="/images/concourse-logo.png" alt="" style={{ width: 22, height: 22 }} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {step === 0 ? "Welcome to Concourse" : "Set up Concourse"}
          </div>
          <div style={{ flex: 1 }} />
          <div
            aria-label={`Step ${step + 1} of ${STEPS.length}: ${current.label}`}
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            {STEPS.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: i === step ? "var(--accent)" : "var(--border)",
                    transition: "background 160ms ease",
                  }}
                />
              </div>
            ))}
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--text-dim)",
                marginLeft: 4,
              }}
            >
              {step + 1} / {STEPS.length}
            </div>
          </div>
        </div>

        {/* Step content — settings pages render standalone with their own headings */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px" }}>
          {current.id === "welcome" && <WelcomeStep />}
          {current.id === "ai" && (
            <StepIntro text="Pick one provider to start — sign in or paste an API key. You can add more anytime in Settings → AI.">
              <AiSettingsPage />
            </StepIntro>
          )}
          {current.id === "git" && (
            <StepIntro text="Set your commit identity and apply the recommended defaults so Pull, Ship, and branches work out of the box.">
              <GitSettingsPage />
            </StepIntro>
          )}
          {current.id === "integrations" && (
            <StepIntro text="Connect your tools (like Jira & Confluence) once — the sign-in follows you into every project, on every AI.">
              <IntegrationsSettingsPage />
            </StepIntro>
          )}
          {current.id === "theme" && (
            <StepIntro text="Last one — pick a look. You can change it anytime in Settings → Theme.">
              <ThemeSettingsPage />
            </StepIntro>
          )}
        </div>

        {/* Footer: skip on the left, back/continue on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "14px 24px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <Btn variant="ghost" icon="chevron-left" onClick={() => setStep(step - 1)}>
              Back
            </Btn>
          )}
          <Btn
            variant="primary"
            onClick={() => (isLast ? void finish() : setStep(step + 1))}
            disabled={saving}
          >
            {step === 0 ? "Let's get you set up" : isLast ? "Start using Concourse" : "Continue"}
          </Btn>
        </div>
      </CardFrame>
    </div>
  );
}

function StepIntro({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: "58ch" }}>{text}</div>
      {children}
    </div>
  );
}

const WELCOME_ITEMS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "sparkles",
    title: "Connect an AI provider",
    body: "Sign in to Claude or add an API key — pick one to start.",
  },
  {
    icon: "git-branch",
    title: "Set up git",
    body: "Your commit identity, so pulling and shipping work.",
  },
  {
    icon: "globe",
    title: "Connect your tools",
    body: "Sign in to Jira & Confluence once — it works everywhere.",
  },
  {
    icon: "sun",
    title: "Make it yours",
    body: "Light or dark, and your accent color.",
  },
];

function WelcomeStep() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 12,
        minHeight: "100%",
        padding: "12px 0",
      }}
    >
      <img src="/images/concourse-logo.png" alt="" style={{ width: 48, height: 48 }} />
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "8px 0 0" }}>
        Every department gets an AI coworker.
      </h1>
      <div style={{ fontSize: 14, color: "var(--text-dim)", maxWidth: "52ch" }}>
        Concourse puts your team's know-how and tools in one place — ask in plain
        English, approve what matters, and everything learned is remembered for
        everyone. Four quick steps and you're in.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginTop: 16,
          width: "100%",
          maxWidth: 640,
        }}
      >
        {WELCOME_ITEMS.map((item, i) => (
          <div
            key={item.title}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              textAlign: "left",
              gap: 6,
              padding: "14px 14px 12px",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "var(--mm-radius, 7px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name={item.icon} size={14} />
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--text-dim)",
                }}
              >
                STEP {i + 1}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{item.body}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
        Everything here can be changed later in Settings.
      </div>
    </div>
  );
}
