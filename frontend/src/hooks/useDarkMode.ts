import { useEffect, useState } from "react";

// Standard: dunkles Warmorange; Nutzer kann auf hell umschalten, die Wahl wird in localStorage gespeichert.
// Mechanismus: im Hellmodus bekommt <html> die Klasse .light (dunkel ist der Standard ohne Klasse).
export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("vr-theme");
    if (saved) return saved === "dark";
    return true; // Standard dunkel
  });

  useEffect(() => {
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("vr-theme", dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
