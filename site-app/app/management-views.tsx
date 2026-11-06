"use client";
import {
  Building2,
  Plus,
  Users,
  Copy,
  FolderOpen,
  Settings2,
  ChevronLeft,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { DatabaseToolbar } from "./database-toolbar";
import { toast } from "sonner";
import type { OpenModal } from "./workspace/types";
import type { Member, WorkspaceData } from "./workspace-types";
import { engagementFlags } from "./workspace/modals/member";

type Props = {
  onOnboard: () => void;
  onBack: () => void;
  view: string;
  data: WorkspaceData;
  clientId: string | null;
  setClientId: (id: string | null) => void;
  onEngagement: (id: string) => void;
  open: OpenModal;
  busy: boolean;
  search: string;
  setSearch: (value: string) => void;
};
const permissions = [
  [
    "Lead Auditor",
    "Approves scope, assigns engagement access and signs reports. Practice administrators manage clients and members.",
  ],
  [
    "Auditor",
    "Prepares papers, uploads evidence, runs tests and manages remediation.",
  ],
  [
    "Reviewer",
    "Independently reviews papers and classification; confirms retests.",
  ],
  [
    "Engagement Quality Reviewer",
    "Outside the engagement team: reviews significant judgments and signs off the final package before release. Cannot edit audit work.",
  ],
  [
    "Client Contributor",
    "Submits evidence only to assigned, expiring client requests.",
  ],
  [
    "Client Viewer",
    "Reads released reports, shared findings and accepted client evidence for one client.",
  ],
];
export function ManagementViews({
  onOnboard,
  onBack,
  view,
  data,
  clientId,
  setClientId,
  onEngagement,
  open,
  busy,
  search,
  setSearch,
}: Props) {
  const [engagementView, setEngagementView] = useState("all"),
    [memberView, setMemberView] = useState("all");
  const lead = !!data.identity.practiceAdmin,
    client = data.clients.find((c) => c.id === clientId),
    matches = (v: string) => v.toLowerCase().includes(search.toLowerCase());
  const engagements = data.engagements.filter(
    (g) =>
      (!clientId || g.client_id === clientId) &&
      (engagementView === "all" ||
        (engagementView === "active" && g.stage !== "Sign-off") ||
        (engagementView === "signoff" && g.stage === "Sign-off")) &&
      matches(
        g.title +
          " " +
          (data.clients.find((c) => c.id === g.client_id)?.name ?? ""),
      ),
  );
  const clients = data.clients.filter((c) => matches(c.name + " " + c.sector));
  const practiceName =
    data.memberships.find((m) => m.tenant_id === data.tenantId)?.name ?? "";
  const invitations = data.invitations ?? [];
  const activeAdmins = data.members.filter(
    (m) => m.practice_admin && m.status === "active",
  ).length;
  const members = data.members.filter(
    (m) =>
      (memberView === "all" || m.status === memberView) &&
      matches(m.display_name + " " + m.role),
  );
  function EngagementTable() {
    return engagements.length ? (
      <Table className="compact-register management-table">
        <TableHeader>
          <TableRow>
            <TableHead>Engagement</TableHead>
            {!client && <TableHead>Client</TableHead>}
            <TableHead>Stage</TableHead>
            <TableHead>Due date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {engagements.map((g) => (
            <TableRow key={g.id}>
              <TableCell>
                <button
                  className="paper-link"
                  onClick={() => onEngagement(g.id)}
                >
                  <FolderOpen
                    size={15}
                    className="inline mr-2 text-muted-foreground"
                  />
                  {g.title}
                </button>
              </TableCell>
              {!client && (
                <TableCell data-label="Client">
                  <button
                    className="paper-link"
                    onClick={() => {
                      setClientId(g.client_id);
                      setSearch("");
                    }}
                  >
                    {data.clients.find((c) => c.id === g.client_id)?.name}
                  </button>
                </TableCell>
              )}
              <TableCell data-label="Stage">
                <span className="badge neutral">{g.stage}</span>
              </TableCell>
              <TableCell data-label="Due date">{g.due_date || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <div className="empty-state">
        <FolderOpen size={28} />
        <h3>
          {search || engagementView !== "all"
            ? "No matching engagements"
            : "No engagements yet"}
        </h3>
        {lead && !search && engagementView === "all" && (
          <Button
            variant="outline"
            onClick={() =>
              open("engagement", {
                clientId: client?.id ?? data.clients[0]?.id ?? "",
              })
            }
          >
            New engagement
          </Button>
        )}
      </div>
    );
  }
  if (view === "Users & access")
    return (
      <>
        <div className="page-head">
          <div className="page-heading">
            <Users size={22} />
            <h1>Members & access</h1>
          </div>
        </div>
        <div className="account-panel">
          <div>
            <b>{data.identity.name}</b>{" "}
            <span className="badge neutral">{data.identity.role}</span>
            <p className="subtle">Your account ID</p>
          </div>
          <div className="copy-account">
            <Input
              aria-label="Your account ID"
              readOnly
              value={data.identity.id}
            />
            <Button
              variant="ghost"
              aria-label="Copy account ID"
              onClick={() => {
                void navigator.clipboard
                  .writeText(data.identity.id)
                  .then(() => toast.success("Account ID copied"))
                  .catch(() =>
                    toast.error("Select and copy the account ID manually"),
                  );
              }}
            >
              <Copy size={16} />
            </Button>
          </div>
        </div>
        {lead && (
          <section className="panel practice-settings">
            <div>
              <p className="subtle">Practice</p>
              <b>{practiceName}</b>{" "}
              <span className="subtle">
                · {activeAdmins} active administrator
                {activeAdmins === 1 ? "" : "s"}
              </span>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => open("practiceRename", { name: practiceName })}
            >
              <Settings2 size={15} /> Rename practice
            </Button>
          </section>
        )}
        {lead && (
          <section className="panel">
            <DatabaseToolbar
              label="Users"
              views={[
                { value: "all", label: "All members" },
                { value: "active", label: "Active" },
                { value: "revoked", label: "Revoked" },
              ]}
              value={memberView}
              onView={setMemberView}
              search={search}
              onSearch={setSearch}
              count={members.length}
            >
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => open("invite", { role: "Auditor" })}
              >
                <Mail size={15} /> Invite by email
              </Button>
              <Button disabled={busy} onClick={onOnboard}>
                <Plus size={15} /> Add member
              </Button>
            </DatabaseToolbar>
            <Table className="user-table compact-register">
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Engagement grants</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell>
                      <b className="font-medium">
                        {m.display_name}
                        {m.user_id === data.identity.id ? " (you)" : ""}
                      </b>
                      {m.practice_admin && (
                        <span className="badge neutral ml-2">
                          <ShieldCheck size={12} className="inline mr-1" />
                          Administrator
                        </span>
                      )}
                      <details className="account-id">
                        <summary>Account ID</summary>
                        <span className="mono">{m.user_id}</span>
                      </details>
                    </TableCell>
                    <TableCell data-label="Role">{m.role}</TableCell>
                    <TableCell data-label="Access">
                      {m.client_id
                        ? data.clients.find((c) => c.id === m.client_id)?.name
                        : "Assigned engagements"}
                    </TableCell>
                    <TableCell data-label="Engagement grants">
                      <MemberGrants member={m} />
                    </TableCell>
                    <TableCell data-label="Status">
                      <span
                        className={
                          "badge " +
                          (m.status === "active" ? "green" : "neutral")
                        }
                      >
                        {m.status === "active" ? "Active" : "Revoked"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {m.user_id !== data.identity.id && (
                        <div className="row-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              open(
                                m.status === "active" ? "memberEdit" : "member",
                                {
                                  userId: m.user_id,
                                  displayName: m.display_name,
                                  role: m.role,
                                  originalRole: m.role,
                                  clientId: m.client_id ?? "",
                                },
                                m.status === "active"
                                  ? engagementFlags(
                                      (m.grants ?? []).map((g) => g.id),
                                    )
                                  : {},
                              )
                            }
                          >
                            {m.status === "active"
                              ? "Edit access"
                              : "Restore access"}
                          </Button>
                          {m.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                open("memberRevoke", {
                                  userId: m.user_id,
                                  displayName: m.display_name,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                          {m.status === "active" &&
                            !m.practice_admin &&
                            !["Client Viewer", "Client Contributor"].includes(
                              m.role,
                            ) && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    open("adminGrant", {
                                      userId: m.user_id,
                                      displayName: m.display_name,
                                    })
                                  }
                                >
                                  Make administrator
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() =>
                                    open("adminTransfer", {
                                      userId: m.user_id,
                                      displayName: m.display_name,
                                    })
                                  }
                                >
                                  Transfer administration
                                </Button>
                              </>
                            )}
                        </div>
                      )}
                      {m.practice_admin &&
                        m.status === "active" &&
                        activeAdmins > 1 && (
                          <div className="row-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                open("adminRevoke", {
                                  userId: m.user_id,
                                  displayName: m.display_name,
                                })
                              }
                            >
                              Remove administration
                            </Button>
                          </div>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!members.length && (
              <p className="empty-result">No matching members.</p>
            )}
          </section>
        )}
        {lead && (
          <section className="panel">
            <h2 className="panel-title">Pending invitations</h2>
            {invitations.length ? (
              <Table className="compact-register management-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <b className="font-medium">{i.email}</b>
                        {i.display_name && (
                          <span className="block subtle">{i.display_name}</span>
                        )}
                      </TableCell>
                      <TableCell data-label="Role">{i.role}</TableCell>
                      <TableCell data-label="Scope">
                        {i.client_id
                          ? data.clients.find((c) => c.id === i.client_id)?.name
                          : i.engagement_ids.length + " engagement(s)"}
                      </TableCell>
                      <TableCell data-label="Expires">
                        {i.expires_at.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            open("invitationCancel", {
                              invitationId: i.id,
                              email: i.email,
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="empty-result">No pending invitations.</p>
            )}
          </section>
        )}
        <details className="help-panel">
          <summary>Add a colleague</summary>
          <ol className="record-list">
            <li>
              Allow the colleague to open this private Site using its sharing
              controls.
            </li>
            <li>
              Use <b>Invite by email</b> to choose their role, client and
              engagements. They join this practice the next time they sign in
              with that email. Alternatively, they sign in, share their account
              ID from <b>Members & access</b>, and you use <b>Add member</b>.
            </li>
            <li>
              Assign further internal engagement access from Assurance workbench
              → Team & runtime, and contributor requests from Evidence vault →
              Requests.
            </li>
          </ol>
          <p className="subtle">
            The platform sends no email: tell the colleague you invited them.
            Revoking a member or changing their role withdraws their engagement
            access and the runner workers they sponsored; restoring access
            grants only what you choose again.
          </p>
        </details>
        <details className="help-panel">
          <summary>Role permissions</summary>
          <div className="role-grid">
            {permissions.map(([role, description]) => (
              <div key={role}>
                <h3>{role}</h3>
                <p>{description}</p>
              </div>
            ))}
          </div>
        </details>
        {!lead && (
          <p className="subtle">
            Contact a practice administrator to change membership. Engagement
            access is assigned separately in the Assurance workbench.
          </p>
        )}
      </>
    );
  if (view === "Clients" && !client)
    return (
      <>
        <div className="page-head">
          <div className="page-heading">
            <Building2 size={22} />
            <h1>Clients</h1>
          </div>
        </div>
        <section className="panel">
          <DatabaseToolbar
            label="Clients"
            views={[{ value: "all", label: "All clients" }]}
            value="all"
            onView={() => {}}
            search={search}
            onSearch={setSearch}
            count={clients.length}
          >
            {lead && (
              <Button disabled={busy} onClick={() => open("client")}>
                <Plus size={15} /> New client
              </Button>
            )}
          </DatabaseToolbar>
          {clients.length ? (
            <Table className="compact-register management-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Client name</TableHead>
                  <TableHead>Sector</TableHead>
                  <TableHead>Engagements</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <button
                        className="client-link"
                        onClick={() => {
                          setClientId(c.id);
                          setSearch("");
                          setEngagementView("all");
                        }}
                      >
                        <span className="client-avatar">
                          <Building2 size={17} />
                        </span>
                        <b>{c.name}</b>
                      </button>
                    </TableCell>
                    <TableCell data-label="Sector">{c.sector}</TableCell>
                    <TableCell data-label="Engagements">
                      {
                        data.engagements.filter((g) => g.client_id === c.id)
                          .length
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="empty-state">
              <Building2 size={28} />
              <h3>{search ? "No matching clients" : "No clients yet"}</h3>
              {search && (
                <Button variant="ghost" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              )}
            </div>
          )}
        </section>
      </>
    );
  return (
    <>
      {view === "Clients" && client && (
        <Button
          variant="ghost"
          size="sm"
          className="back-to-clients"
          onClick={onBack}
        >
          <ChevronLeft size={14} /> All clients
        </Button>
      )}
      <div className="page-head">
        <div className="page-heading">
          <FolderOpen size={22} />
          <h1>{view === "Clients" ? client?.name : "Engagements"}</h1>
        </div>
        {lead && view === "Clients" && client && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              open("clientEdit", {
                clientId: client.id,
                name: client.name,
                sector: client.sector,
              })
            }
          >
            <Settings2 size={15} /> Properties
          </Button>
        )}
      </div>
      {view === "Clients" && (
        <div className="client-properties">
          <span>
            Sector <b>{client?.sector}</b>
          </span>
          <span>
            {data.engagements.filter((g) => g.client_id === clientId).length}{" "}
            engagements
          </span>
        </div>
      )}
      <section className="panel">
        <DatabaseToolbar
          label="Engagements"
          views={[
            { value: "all", label: "Assigned engagements" },
            { value: "active", label: "In progress" },
            { value: "signoff", label: "Sign-off" },
          ]}
          value={engagementView}
          onView={setEngagementView}
          search={search}
          onSearch={setSearch}
          count={engagements.length}
        >
          {view === "Engagements" && (
            <Select
              value={clientId ?? "all"}
              onValueChange={(v) => setClientId(v === "all" ? null : v)}
            >
              <SelectTrigger aria-label="Filter by client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {data.clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {lead && (
            <Button
              disabled={busy || !data.clients.length}
              onClick={() =>
                open("engagement", {
                  clientId: client?.id ?? data.clients[0]?.id ?? "",
                })
              }
            >
              <Plus size={15} /> New engagement
            </Button>
          )}
        </DatabaseToolbar>
        {/* eslint-disable-next-line react-hooks/static-components -- EngagementTable closes over this render's filters; hoisting it would also end its per-render remount, a behaviour change */}
        <EngagementTable />
      </section>
    </>
  );
}

/** A member's live engagement grants and the runner workers they sponsor. */
function MemberGrants({ member }: { member: Member }) {
  const grants = member.grants ?? [];
  if (member.status !== "active") return <span className="subtle">None</span>;
  return (
    <>
      {grants.length ? (
        <ul className="grant-list">
          {grants.map((g) => (
            <li key={g.id}>{g.title}</li>
          ))}
        </ul>
      ) : (
        <span className="subtle">
          {member.client_id ? "Client access" : "None"}
        </span>
      )}
      {!!member.sponsored_workers && (
        <small className="block subtle">
          Sponsors {member.sponsored_workers} runner worker
          {member.sponsored_workers === 1 ? "" : "s"}
        </small>
      )}
    </>
  );
}
