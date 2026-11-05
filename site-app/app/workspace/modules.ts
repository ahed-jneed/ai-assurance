import {
  AlertTriangle,
  BookOpen,
  Building2,
  ClipboardCheck,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from "lucide-react";
/** Engagement modules, with the icon shown beside the page heading. */
export const navigation = [
  ["Overview", LayoutDashboard],
  ["Audit program", ClipboardCheck],
  ["Working papers", FileText],
  ["Evidence vault", Database],
  ["Testing lab", FlaskConical],
  ["Assurance workbench", ShieldCheck],
  ["Findings", AlertTriangle],
  ["Regulatory mapping", BookOpen],
  ["Reports & sign-off", ClipboardCheck],
  ["Methodology", BookOpen],
] as const;
/** Practice-level modules that do not need a selected engagement. */
export const managementNavigation = [
  ["My work", LayoutDashboard],
  ["Clients", Building2],
  ["Engagements", ClipboardCheck],
  ["Users & access", Users],
] as const;
/** Views rendered by the practice-management panels. */
export const managementViews = ["Clients", "Engagements", "Users & access"];
export const isManagementView = (view: string) =>
  managementViews.includes(view);
export const evidenceCategories = [
  "Dataset",
  "Model",
  "Training log",
  "Validation",
  "Pipeline code",
  "Governance",
  "Instructions",
  "Oversight",
  "Security",
  "Other",
];
