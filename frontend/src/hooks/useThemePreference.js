/**
 * OpenShift Airgap Architect - light/dark theme preference
 *
 * One source for the theme: `localStorage["airgap-theme"]`, applied as
 * `body[data-theme]`. Extracted from AppShell (v2.2.0 M2) so the Mirroring
 * workspace, which renders outside the Install shell, applies the same
 * preference on its own and both workflows stay in step.
 *
 * @author Bill Strauss
 *
 * Developed with AI assistance from Claude (Anthropic).
 */
import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "airgap-theme";

export function useThemePreference() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_STORAGE_KEY) || "light");
  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
  return [theme, setTheme];
}
