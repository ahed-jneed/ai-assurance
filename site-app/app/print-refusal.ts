import { cacheForRequest } from "vinext/cache";

/**
 * The refusal of the current print-view request (/report, /ll144-summary),
 * shared between the page and its forbidden.tsx boundary (#216, #220).
 * forbidden() takes no argument and the boundary renders without props, so
 * the page records the refusal's own message here, scoped to the request,
 * before it calls forbidden(). The message only describes the viewer's own
 * access (for example an archived practice or lapsed access), so it is shown
 * to them as it is.
 */
export const printRefusal = cacheForRequest((): { message?: string } => ({}));
