"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Building2,
  FolderOpen,
  FileText,
  Database,
  FlaskConical,
  AlertTriangle,
  BookOpen,
  ClipboardList,
  UsersRound,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  ShieldCheck,
  Scale,
  FileCheck2,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Star,
  Clock3,
  SlidersHorizontal,
  Check,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  defaultNavigation,
  navigationPreferenceKey,
  parseNavigationPreferences,
  permittedNavigationRoutes,
  type NavigationRoute,
} from "@/lib/navigation-preferences";
import type { WorkspaceData } from "./workspace-types";

const auditModules: readonly (readonly [
  NavigationRoute,
  LucideIcon,
  string,
])[] = [
  ["Overview", LayoutDashboard, "Overview"],
  ["Audit program", ClipboardList, "Audit program"],
  ["Regulatory mapping", Scale, "Regulatory mapping"],
  ["Working papers", FileText, "Working papers"],
  ["Evidence vault", Database, "Evidence vault"],
  ["Testing lab", FlaskConical, "Testing lab"],
  ["Assurance workbench", ShieldCheck, "Assurance workbench"],
  ["Findings", AlertTriangle, "Findings"],
  ["Reports & sign-off", FileCheck2, "Reports & sign-off"],
  ["Methodology", BookOpen, "Templates & history"],
];
const practiceModules: readonly (readonly [
  NavigationRoute,
  LucideIcon,
  string,
])[] = [
  ["My work", LayoutDashboard, "My work"],
  ["Clients", Building2, "Clients"],
  ["Engagements", FolderOpen, "Engagements"],
];
const allModules = [
  ...auditModules,
  ...practiceModules,
  ["Users & access", UsersRound, "Members & access"] as const,
];

export function WorkspaceNavigation({
  data,
  view,
  onNavigate,
  onPractice,
  onSwitch,
  onSearch,
  searchDisabled,
  navigationDisabled,
  width,
  onWidthChange,
  account,
}: {
  data: WorkspaceData | null;
  view: string;
  onNavigate: (
    v: string,
    options?: { search?: string; filter?: string; facet?: string },
    afterOpen?: () => void,
  ) => string;
  onPractice: (id: string) => string;
  onSwitch: () => string;
  onSearch: () => void;
  searchDisabled: boolean;
  navigationDisabled: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  /** The account menu (app/account-menu.tsx), beside the signed-in identity. */
  account?: ReactNode;
}) {
  const { open, setOpen, openMobile, setOpenMobile, isMobile, toggleSidebar } =
    useSidebar();
  const e = data?.engagement,
    compact = !isMobile && !open;
  const [preferences, setPreferences] = useState(defaultNavigation),
    [restoredKey, setRestoredKey] = useState("");
  const [quickOpen, setQuickOpen] = useState(false),
    [customize, setCustomize] = useState(false),
    [resizing, setResizing] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null),
    dragRef = useRef<{ x: number; width: number } | null>(null);
  const setters = useRef({ setOpen, onWidthChange });
  // eslint-disable-next-line react-hooks/refs -- latest-setters ref so that the restore effect depends only on preferenceKey; writing it during render is the current behaviour
  setters.current = { setOpen, onWidthChange };
  const preferenceKey = data
    ? navigationPreferenceKey(data.identity.id, data.tenantId)
    : "";
  const allowed = data
      ? permittedNavigationRoutes(data.identity.role, !!e)
      : [],
    allowedKey = allowed.join("|");
  const visibleAudit = auditModules.filter(([route]) =>
    allowed.includes(route),
  );
  const pins = preferences.pins.filter((route) => allowed.includes(route)),
    recent = preferences.recent.filter((route) => allowed.includes(route));
  const practiceName =
    data?.memberships.find((m) => m.tenant_id === data.tenantId)?.name ??
    "Audit practice";
  const clientName =
    data?.clients.find((c) => c.id === e?.clientId)?.name ?? "";
  const initials =
    data?.identity.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "AA";

  useEffect(() => {
    if (!preferenceKey) return;
    let saved = null;
    try {
      saved = parseNavigationPreferences(localStorage.getItem(preferenceKey));
    } catch {}
    const next = saved ?? defaultNavigation;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores navigation preferences from browser-only storage after hydration
    setPreferences(next);
    setters.current.setOpen(!next.compact);
    setters.current.onWidthChange(next.width);
    setRestoredKey(preferenceKey);
  }, [preferenceKey]);
  useEffect(() => {
    if (
      restoredKey !== preferenceKey ||
      !allowed.includes(view as NavigationRoute)
    )
      return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records the current view as recent once the stored preferences are restored
    setPreferences((p) =>
      p.recent[0] === view
        ? p
        : {
            ...p,
            recent: [
              view as NavigationRoute,
              ...p.recent.filter((route) => route !== view),
            ].slice(0, 5),
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- allowedKey is the stable stand-in for the allowed array, which is rebuilt on every render
  }, [view, allowedKey, restoredKey, preferenceKey]);
  useEffect(() => {
    if (!preferenceKey || restoredKey !== preferenceKey) return;
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ ...preferences, compact: !open }),
      );
    } catch {}
  }, [preferences, open, preferenceKey, restoredKey]);

  const revealCurrent = useCallback(() => {
    const content = shellRef.current?.querySelector<HTMLElement>(
      '[data-slot="sidebar-content"]',
    );
    const active = content?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!content || !active) return;
    const visible = content.getBoundingClientRect(),
      target = active.getBoundingClientRect();
    if (target.top < visible.top + 8)
      content.scrollTop += target.top - visible.top - 8;
    else if (target.bottom > visible.bottom - 8)
      content.scrollTop += target.bottom - visible.bottom + 8;
  }, []);
  const attachShell = useCallback(
    (node: HTMLDivElement | null) => {
      shellRef.current = node;
      if (node) requestAnimationFrame(revealCurrent);
    },
    [revealCurrent],
  );
  useEffect(() => {
    if (!isMobile || openMobile) revealCurrent();
  }, [view, compact, isMobile, openMobile, revealCurrent]);
  useEffect(() => {
    setOpenMobile(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closes the quick-page menu after switching practice or engagement
    setQuickOpen(false);
  }, [data?.tenantId, e?.id, setOpenMobile]);

  function go(route: NavigationRoute, filter?: string) {
    if (!allowed.includes(route)) return;
    onNavigate(
      route,
      filter ? { filter, search: "", facet: "all" } : undefined,
      () => {
        setOpenMobile(false);
        setQuickOpen(false);
      },
    );
  }
  function changeWidth(value: number) {
    const next = Math.min(360, Math.max(248, Math.round(value)));
    onWidthChange(next);
    setPreferences((p) => ({ ...p, width: next }));
  }
  function togglePin(route: NavigationRoute) {
    if (!allowed.includes(route)) return;
    setPreferences((p) =>
      p.pins.includes(route)
        ? { ...p, pins: p.pins.filter((r) => r !== route) }
        : pins.length < 4
          ? { ...p, pins: [...pins, route] }
          : p,
    );
  }
  function attention(route: NavigationRoute) {
    // Damaged engagement records alert practice administrators wherever they
    // are; the Engagements page lists them.
    if (route === "Engagements")
      return data?.integrityIncidents?.count
        ? {
            count: data.integrityIncidents.count,
            label: "integrity incidents",
            filter: "",
          }
        : null;
    if (
      !e ||
      !data ||
      ["Client Viewer", "Client Contributor"].includes(data.identity.role)
    )
      return null;
    if (route === "Evidence vault")
      return {
        count: e.artifacts.filter((a) => a.status === "unverified").length,
        label: "awaiting acceptance",
        filter: "unverified",
      };
    if (
      route === "Working papers" &&
      ["Reviewer", "Lead Auditor"].includes(data.identity.role)
    )
      return {
        count: e.papers.filter((p) => p.status === "in_review").length,
        label: "awaiting review",
        filter: "in_review",
      };
    if (route === "Findings")
      return {
        count: e.findings.filter(
          (f) =>
            f.status !== "closed" && ["High", "Critical"].includes(f.severity),
        ).length,
        label: "open high-risk findings",
        filter: "high",
      };
    return null;
  }
  function item([route, Icon, label]: readonly [
    NavigationRoute,
    LucideIcon,
    string,
  ]) {
    const work = attention(route),
      n = work?.count ?? 0;
    const accessibleLabel =
      compact && n > 0 ? label + ", " + n + " " + work!.label : label;
    return (
      <SidebarMenuItem key={route} className="navigation-row">
        <SidebarMenuButton
          isActive={view === route}
          disabled={navigationDisabled}
          aria-current={view === route ? "page" : undefined}
          aria-label={accessibleLabel}
          tooltip={accessibleLabel}
          onClick={() => go(route)}
          className={n ? "nav-destination has-attention" : "nav-destination"}
        >
          <Icon aria-hidden="true" />
          <span className="nav-item-label">{label}</span>
          {compact && n > 0 && (
            <span className="nav-attention-dot" aria-hidden="true" />
          )}
        </SidebarMenuButton>
        {n > 0 && !compact && (
          <button
            className="nav-attention"
            disabled={navigationDisabled}
            aria-label={"Open " + n + " " + work!.label}
            title={n + " " + work!.label}
            onClick={() => go(route, work!.filter)}
          >
            {n > 99 ? "99+" : n}
          </button>
        )}
      </SidebarMenuItem>
    );
  }
  function tip(label: string, child: ReactNode) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{child}</TooltipTrigger>
        <TooltipContent side="right" hidden={!compact}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }
  function quickPage(route: NavigationRoute) {
    const entry = allModules.find((m) => m[0] === route)!;
    const Icon = entry[1];
    return (
      <button
        key={route}
        className="nav-quick-page"
        disabled={navigationDisabled}
        onClick={() => go(route)}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{entry[2]}</span>
        {route === view && <Check size={14} aria-label="Current page" />}
      </button>
    );
  }

  return (
    <Sidebar className="audit-sidebar" collapsible="icon">
      <div
        className="audit-nav-shell"
        ref={attachShell}
        data-compact={compact}
        data-resizing={resizing}
      >
        <SidebarHeader>
          <div className="nav-brand-row">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="nav-workspace"
                  disabled={navigationDisabled}
                  aria-label={"Workspace: " + practiceName}
                >
                  <span className="nav-brand-symbol">
                    <ShieldCheck size={19} aria-hidden="true" />
                  </span>
                  <span className="nav-brand-copy">
                    <b>Assurance</b>
                    <small>{practiceName}</small>
                  </span>
                  <ChevronDown
                    size={13}
                    className="nav-workspace-chevron"
                    aria-hidden="true"
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="nav-dark-menu"
                align="start"
                sideOffset={8}
              >
                <DropdownMenuLabel>Switch practice</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={data?.tenantId}
                  onValueChange={(id) => {
                    if (onPractice(id) === "opened") setOpenMobile(false);
                  }}
                >
                  {data?.memberships.map((m) => (
                    <DropdownMenuRadioItem
                      key={m.tenant_id}
                      value={m.tenant_id}
                    >
                      {m.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => go("Clients")}>
                  <Building2 size={16} />
                  Client directory
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => go("Engagements")}>
                  <FolderOpen size={16} />
                  Engagement directory
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {tip(
              compact ? "Expand sidebar" : "Collapse sidebar",
              <button
                className="nav-collapse-control"
                aria-label={
                  isMobile
                    ? "Close navigation"
                    : compact
                      ? "Expand sidebar"
                      : "Collapse sidebar"
                }
                aria-expanded={isMobile ? true : open}
                title="Ctrl B"
                onClick={() =>
                  isMobile ? setOpenMobile(false) : toggleSidebar()
                }
              >
                {isMobile ? (
                  <X size={18} />
                ) : compact ? (
                  <PanelLeftOpen size={18} />
                ) : (
                  <PanelLeftClose size={17} />
                )}
              </button>,
            )}
          </div>
          <div className="nav-search-row">
            {tip(
              "Search workspace",
              <button
                className="nav-search"
                disabled={searchDisabled}
                aria-label="Search workspace"
                onClick={() => {
                  setOpenMobile(false);
                  onSearch();
                }}
              >
                <Search size={16} aria-hidden="true" />
                <span>Search workspace</span>
                <kbd>Ctrl K</kbd>
              </button>,
            )}
            <Popover
              open={quickOpen}
              onOpenChange={(open) => {
                setQuickOpen(open);
                if (!open) setCustomize(false);
              }}
            >
              <PopoverTrigger asChild>
                <button
                  className="nav-quick-trigger"
                  disabled={navigationDisabled}
                  aria-label="Pinned & recent pages"
                  title="Pinned & recent pages"
                >
                  <Star size={17} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="nav-quick-popover"
                align="start"
                side={compact ? "right" : "bottom"}
              >
                <div className="nav-popover-heading">
                  <h2>
                    {customize ? "Customize pinned pages" : "Quick access"}
                  </h2>
                  <button onClick={() => setCustomize((v) => !v)}>
                    {customize ? "Done" : "Customize"}
                  </button>
                </div>
                {customize ? (
                  <>
                    <p className="nav-popover-note">Choose up to 4 pages.</p>
                    <div className="nav-pin-options">
                      {allModules
                        .filter(([route]) => allowed.includes(route))
                        .map(([route, Icon, label]) => (
                          <button
                            key={route}
                            aria-pressed={pins.includes(route)}
                            disabled={!pins.includes(route) && pins.length >= 4}
                            onClick={() => togglePin(route)}
                          >
                            <Icon size={16} aria-hidden="true" />
                            <span>{label}</span>
                            {pins.includes(route) ? (
                              <Check size={15} aria-hidden="true" />
                            ) : (
                              <Star size={14} aria-hidden="true" />
                            )}
                          </button>
                        ))}
                    </div>
                  </>
                ) : (
                  <div className="nav-quick-lists">
                    <h3>
                      <Star size={13} />
                      Pinned pages
                    </h3>
                    {pins.length ? (
                      pins.map(quickPage)
                    ) : (
                      <button
                        className="nav-pin-invitation"
                        onClick={() => setCustomize(true)}
                      >
                        Choose pages to pin
                      </button>
                    )}
                    {recent.length > 0 && (
                      <>
                        <h3>
                          <Clock3 size={13} />
                          Recently visited
                        </h3>
                        {recent.map(quickPage)}
                      </>
                    )}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {e
            ? tip(
                "Switch engagement: " + e.title,
                <button
                  className="nav-engagement"
                  disabled={navigationDisabled}
                  aria-label={"Switch engagement: " + e.title}
                  onClick={() => {
                    if (onSwitch() === "opened") setOpenMobile(false);
                  }}
                >
                  <FolderOpen
                    size={17}
                    className="nav-engagement-icon"
                    aria-hidden="true"
                  />
                  <span className="nav-engagement-copy">
                    <small>{clientName}</small>
                    <b>{e.title}</b>
                  </span>
                  <ChevronDown
                    size={14}
                    className="nav-switch-icon"
                    aria-hidden="true"
                  />
                </button>,
              )
            : data && (
                <button
                  className="nav-engagement nav-engagement-empty"
                  disabled={navigationDisabled}
                  onClick={() => go("Engagements")}
                >
                  <FolderOpen size={17} aria-hidden="true" />
                  <span>Choose an engagement</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Audit workspace navigation">
            {e && (
              <section className="nav-section">
                <div className="nav-section-heading">
                  <span>Engagement</span>
                  <small>{e.stage}</small>
                </div>
                <SidebarMenu>{visibleAudit.map(item)}</SidebarMenu>
              </section>
            )}
            <section className="nav-section nav-practice-section">
              <div className="nav-section-heading">
                <span>Practice</span>
              </div>
              <SidebarMenu>
                {practiceModules
                  .filter(([route]) => allowed.includes(route))
                  .map(item)}
              </SidebarMenu>
            </section>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            {item(["Users & access", UsersRound, "Members & access"])}
          </SidebarMenu>
          <div className="nav-identity">
            <span className="nav-avatar" aria-hidden="true">
              {initials}
            </span>
            <div>
              <b>{data?.identity.name ?? "Audit workspace"}</b>
              <small>{data?.identity.role ?? "Signing in…"}</small>
            </div>
            {account}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="nav-preferences-trigger"
                  aria-label="Sidebar preferences"
                  title="Sidebar preferences"
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="nav-preferences-popover"
                align="end"
                side="right"
              >
                <h2>Sidebar preferences</h2>
                <label htmlFor="sidebar-width">
                  Width <span>{width}px</span>
                </label>
                <input
                  id="sidebar-width"
                  type="range"
                  min={248}
                  max={360}
                  step={8}
                  value={width}
                  onChange={(event) => changeWidth(Number(event.target.value))}
                />
                <button
                  className="nav-preference-action"
                  onClick={() => setOpen(!open)}
                >
                  {open ? (
                    <PanelLeftClose size={16} />
                  ) : (
                    <PanelLeftOpen size={16} />
                  )}
                  <span>{open ? "Collapse to icons" : "Expand sidebar"}</span>
                  <kbd>Ctrl B</kbd>
                </button>
                <button
                  className="nav-preference-reset"
                  onClick={() => {
                    changeWidth(defaultNavigation.width);
                    setOpen(true);
                  }}
                >
                  Reset layout
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </SidebarFooter>
        {!isMobile && !compact && (
          <button
            className="nav-resize-handle"
            role="separator"
            tabIndex={0}
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={248}
            aria-valuemax={360}
            aria-valuenow={width}
            aria-controls="audit-main-content"
            title="Drag to resize. Arrow keys adjust width; Enter resets."
            onDoubleClick={() => changeWidth(defaultNavigation.width)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowLeft"
                  ? width - 8
                  : event.key === "ArrowRight"
                    ? width + 8
                    : event.key === "Home"
                      ? 248
                      : event.key === "End"
                        ? 360
                        : event.key === "Enter"
                          ? defaultNavigation.width
                          : null;
              if (next !== null) {
                event.preventDefault();
                changeWidth(next);
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              dragRef.current = { x: event.clientX, width };
              event.currentTarget.setPointerCapture(event.pointerId);
              setResizing(true);
            }}
            onPointerMove={(event) => {
              if (dragRef.current)
                changeWidth(
                  dragRef.current.width + event.clientX - dragRef.current.x,
                );
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              setResizing(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              setResizing(false);
            }}
          />
        )}
      </div>
    </Sidebar>
  );
}
