import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "mc.theme";

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  try {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Theme hook. Avoids React 19 hydration mismatches by never rendering the
 * `data-theme` attribute via JSX — we SSR with the default and mutate
 * `document.documentElement` post-hydration. The pre-hydration script in
 * __root.tsx applies the stored theme before first paint to avoid a flash.
 */
export function useTheme(): {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
} {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const set = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };
  const toggle = () => set(theme === "dark" ? "light" : "dark");

  return { theme, toggle, set };
}
