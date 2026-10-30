export const navigationRoutes = ['My work','Overview','Audit program','Regulatory mapping','Working papers','Evidence vault','Testing lab','Assurance workbench','Findings','Reports & sign-off','Methodology','Clients','Engagements','Users & access'] as const;
export type NavigationRoute = typeof navigationRoutes[number];
export type NavigationPreferences = { compact: boolean; width: number; pins: NavigationRoute[]; recent: NavigationRoute[] };
export const defaultNavigation: NavigationPreferences = { compact: false, width: 272, pins: [], recent: [] };
export const navigationPreferenceKey = (userId: string, tenantId: string) => 'assurance.navigation.v2.' + userId + '.' + tenantId;
export const permittedNavigationRoutes = (role: string, hasEngagement: boolean): NavigationRoute[] => {
  const client = ['Client Viewer','Client Contributor'].includes(role);
  return navigationRoutes.filter(route => route==='My work'?!client:['Clients','Engagements','Users & access'].includes(route) || hasEngagement && (!client || ['Overview','Evidence vault','Findings','Reports & sign-off'].includes(route)));
};
export function parseNavigationPreferences(raw: string | null): NavigationPreferences | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.compact !== 'boolean' || !Number.isFinite(value.width) || !Array.isArray(value.pins) || !Array.isArray(value.recent)) return null;
    const routes = (items: unknown[], limit: number) => [...new Set(items.filter((item): item is NavigationRoute => typeof item === 'string' && navigationRoutes.includes(item as NavigationRoute)))].slice(0, limit);
    return { compact: value.compact, width: Math.min(360, Math.max(248, Math.round(value.width))), pins: routes(value.pins, 4), recent: routes(value.recent, 5) };
  } catch { return null; }
}
export function parseRecentEngagements(raw: string | null): string[] {
  if (!raw || raw.length > 4096) return [];
  try { const value = JSON.parse(raw); return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 200))].slice(0, 5) : []; } catch { return []; }
}
