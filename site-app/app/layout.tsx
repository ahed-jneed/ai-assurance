import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./workspace-polish.css";
import "./sidebar-navigation.css";
import "./audit-records.css";
import "./responsive.css";
import "./business-workspace.css";
import "./report-workspace.css";
import "./work-inbox.css";
import "./evidence-workspace.css";
import "./workbench-experience.css";
import "./criteria.css";
import "./management-system.css";
import "./paper-workspace.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "AI Assurance | Audit Workspace",
  description:
    "EU AI Act assurance, evidence and audit working papers for traditional machine learning.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
