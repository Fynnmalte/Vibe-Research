import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Radar, LayoutGrid, Wallet, Settings, Search, NotebookPen,
  Moon, Sun, ChevronsLeft, ChevronsRight, LineChart, Github, UserRound,
  Cog, Cpu, Database, Cable, Rocket, FlaskConical, Star, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";

const APP_VERSION = "v0.1.1";
const REPO_URL = "https://github.com/simonlin1212/Vibe-Research";
const SITE_URL = "https://www.simonlin.net"; // Autoren-Homepage

const NAV = [
  { to: "/daily-review", icon: Activity, label: "Tagesrückblick" },
  { to: "/intel", icon: Radar, label: "Nachrichten-Radar" },
  { to: "/sectors", icon: LayoutGrid, label: "Sektoren" },
  { to: "/stock-data", icon: Search, label: "Aktiendaten" },
  { to: "/watchlist", icon: Star, label: "Watchlist" },
  { to: "/portfolio", icon: Wallet, label: "Mein Portfolio" },
  { to: "/my-reports", icon: FileText, label: "Meine Analysen" },
  { to: "/notes", icon: NotebookPen, label: "Notizen" },
  { to: "/settings", icon: Settings, label: "KI verbinden" },
];

// Häufig beobachtete Sektoren als Schnellzugriff unter »Sektoren« (eingerückt).
const SECTOR_LINKS = [
  { to: "/sectors/humanoid", icon: Cog, label: "Humanoide Roboter" },
  { to: "/sectors/ai-computing", icon: Cpu, label: "KI-Rechenleistung" },
  { to: "/sectors/hbm", icon: Database, label: "HBM" },
  { to: "/sectors/cpo", icon: Cable, label: "Optische Vernetzung" },
  { to: "/sectors/business-space", icon: Rocket, label: "Kommerzielle Raumfahrt" },
  { to: "/sectors/ai-pharma", icon: FlaskConical, label: "Biopharma" },
];

export function Layout() {
  const { pathname } = useLocation();
  const { dark, toggle } = useDarkMode();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("vr-sidebar") === "collapsed");

  useEffect(() => {
    localStorage.setItem("vr-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className={cn(
        "glass z-10 m-2 flex shrink-0 flex-col rounded-2xl transition-all duration-200",
        collapsed ? "w-14" : "w-60",
      )}>
        {/* Brand */}
        <div className={cn("border-b border-border/50", collapsed ? "flex justify-center p-3" : "p-4")}>
          <Link to="/daily-review" className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <LineChart className="h-5 w-5 shrink-0 text-primary" />
            {!collapsed && (
              <span className="font-head text-lg font-semibold tracking-tight">
                Vibe-<span className="text-primary">Research</span>
              </span>
            )}
          </Link>
          {!collapsed && <p className="mt-1 text-[11px] text-muted-foreground">Persönliches KI-Research · US/EU/HK</p>}
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 space-y-1 overflow-auto", collapsed ? "p-1.5" : "p-2.5")}>
          {NAV.map(({ to, icon: Icon, label }) => {
            const active = pathname === to;
            return (
              <div key={to}>
                <Link
                  to={to}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center rounded-lg text-sm transition-colors",
                    collapsed ? "justify-center p-2.5" : "gap-2.5 px-3 py-2.5",
                    active
                      ? "bg-primary/15 font-medium text-primary shadow-glow"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && label}
                </Link>

                {/* Unter Sektoren: Schnellzugriff auf häufig beobachtete Sektoren (eingerückt) */}
                {to === "/sectors" && (
                  <div className={cn("mt-1 space-y-0.5", !collapsed && "ml-4 border-l border-border/40 pl-1.5")}>
                    {SECTOR_LINKS.map(({ to: st, icon: SIcon, label: slabel }) => {
                      const sactive = pathname === st;
                      return (
                        <Link
                          key={st}
                          to={st}
                          title={collapsed ? slabel : undefined}
                          className={cn(
                            "flex items-center rounded-lg transition-colors",
                            collapsed ? "justify-center p-2" : "gap-2 px-2.5 py-1.5 text-[13px]",
                            sactive
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground/80 hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <SIcon className="h-3.5 w-3.5 shrink-0" />
                          {!collapsed && slabel}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={cn("border-t border-border/50", collapsed ? "flex flex-col items-center gap-2 p-2" : "space-y-2 p-3")}>
          {collapsed ? (
            <>
              <button onClick={toggle} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title={dark ? "Hell" : "Dunkel"}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <a href={SITE_URL} target="_blank" rel="noreferrer" className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="Autor kontaktieren">
                <UserRound className="h-4 w-4" />
              </a>
              <button onClick={() => setCollapsed(false)} className="rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground" title="Ausklappen">
                <ChevronsRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <button onClick={toggle} className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                  {dark ? "Hell" : "Dunkel"}
                </button>
                <div className="flex items-center gap-2">
                  <a href={SITE_URL} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground" title="Autor kontaktieren">
                    <UserRound className="h-3.5 w-3.5" />
                  </a>
                  <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-muted-foreground transition-colors hover:text-foreground" title="GitHub">
                    <Github className="h-3.5 w-3.5" />
                  </a>
                  <button onClick={() => setCollapsed(true)} className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground" title="Einklappen">
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <a href={SITE_URL} target="_blank" rel="noreferrer" className="block text-[11px] text-primary/80 transition-colors hover:text-primary">
                Autor kontaktieren · simonlin.net
              </a>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                {APP_VERSION} · keine Empfehlung · keine Prognose · neutral
              </p>
            </>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
