"use client";

// The assurance workbench lives in app/assurance-workbench/ (#187): the
// shell in workbench.tsx, one module per section and dialog, and the hooks
// that load its data and keep its form state. This entry keeps the import
// path of its importers.
export { AssuranceWorkbench } from "./assurance-workbench/workbench";
