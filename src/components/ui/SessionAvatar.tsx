import { useEffect, useState } from "react";
import { SessionIcon } from "~/components/ui/SessionIcon";
import { isSessionIcon, DEFAULT_SESSION_ICON } from "~/lib/session-icons";

// Session avatar with the same vocabulary as project icons: a custom image
// wins, then a user-typed monogram (icon that's short text, not a lucide id),
// then the lucide icon the title generator picked, tinted by iconColor.

type TaskLike = {
  title: string;
  icon: string | null;
  iconColor?: string | null;
  imagePath?: string | null;
  updatedAt?: number;
};

export function sessionMonogram(task: Pick<TaskLike, "title" | "icon">): string | null {
  const icon: string = task.icon?.trim() ?? "";
  // isSessionIcon's guard (`value is string`) would collapse the false branch
  // to never, so keep the boolean un-narrowed.
  const isLucide: boolean = isSessionIcon(icon);
  if (icon !== "" && !isLucide && icon.length <= 3) return icon.toUpperCase();
  // No icon at all → project-style default: the title's first two letters.
  if (!icon) {
    const letters = task.title.trim().slice(0, 2).toUpperCase();
    return letters || null;
  }
  return null;
}

export function SessionAvatar({
  task,
  size = 56,
  iconSize,
}: {
  task: TaskLike;
  size?: number;
  iconSize?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [task.imagePath, task.updatedAt]);

  const color = task.iconColor?.trim() || null;

  if (task.imagePath && !imgFailed) {
    return (
      <img
        src={`app://project-image/${task.imagePath}?v=${task.updatedAt ?? 0}`}
        alt=""
        onError={() => setImgFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.25,
          objectFit: "cover",
          border: `1px solid ${color ? `${color}33` : "var(--border)"}`,
          flexShrink: 0,
          display: "block",
        }}
      />
    );
  }

  const monogram = sessionMonogram(task);
  const frame: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: size * 0.25,
    background: color
      ? `linear-gradient(135deg, ${color}22, ${color}08)`
      : "linear-gradient(180deg, var(--surface-2), var(--surface-1))",
    border: `1px solid ${color ? `${color}33` : "var(--border)"}`,
    boxShadow: color
      ? "none"
      : "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: color ?? "var(--text-dim)",
    flexShrink: 0,
  };

  if (monogram) {
    return (
      <div
        style={{
          ...frame,
          fontFamily: "var(--mono)",
          fontSize: size * 0.34,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        {monogram}
      </div>
    );
  }

  const lucide = isSessionIcon(task.icon) ? task.icon! : DEFAULT_SESSION_ICON;
  return (
    <div style={frame}>
      <SessionIcon name={lucide} size={iconSize ?? size * 0.46} strokeWidth={1.5} />
    </div>
  );
}
