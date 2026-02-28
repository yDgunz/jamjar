import { useEffect, useState } from "react";
import { api, isSuperAdmin } from "../api";
import type { AdminUser, AdminGroup, Role, UsageStats } from "../api";
import FormModal from "../components/FormModal";
import Modal, { Toast } from "../components/Modal";
import { AdminSkeleton } from "../components/PageLoadingSkeleton";
import { useAuth } from "../context/AuthContext";

const ROLES: Role[] = ["readonly", "editor", "admin", "superadmin"];
type Tab = "users" | "groups" | "usage";

const EVENT_LABELS: Record<string, string> = {
  login: "Logins",
  upload: "Uploads",
  tag: "Tags",
  song_edit: "Song edits",
  setlist_create: "Setlists created",
  setlist_edit: "Setlist edits",
};
const EVENT_TYPES = Object.keys(EVENT_LABELS);

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso + "Z");
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso + "Z");
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) {
    const day = d.toLocaleDateString([], { weekday: "short" });
    return `${day} ${time}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function eventAction(type: string): string {
  const actions: Record<string, string> = {
    login: "logged in",
    upload: "uploaded",
    tag: "tagged",
    song_edit: "edited song",
    setlist_create: "created setlist",
    setlist_edit: "edited setlist",
  };
  return actions[type] ?? type;
}

export default function Admin() {
  const { user: currentUser } = useAuth();

  if (!isSuperAdmin(currentUser)) {
    return (
      <div>
        <h1 className="mb-4 text-lg font-bold">Admin</h1>
        <p className="text-gray-400">You do not have permission to access this page.</p>
      </div>
    );
  }

  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; variant: "error" | "success" } | null>(null);

  // Usage stats
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [statsError, setStatsError] = useState("");

  // Add user modal
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("editor");
  const [addingUser, setAddingUser] = useState(false);

  // Edit user modal
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<Role>("editor");
  const [editPw, setEditPw] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Add group modal
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);

  // Delete confirmation
  const [deleteModal, setDeleteModal] = useState<{
    type: "user" | "group";
    id: number;
    name: string;
  } | null>(null);

  const refresh = async () => {
    const [u, g] = await Promise.all([api.adminListUsers(), api.adminListGroups()]);
    setUsers(u);
    setGroups(g);
  };

  const loadStats = () => {
    api.adminGetUsageStats().then(setStats).catch((e) => setStatsError(e.message));
  };

  useEffect(() => {
    refresh().then(() => setLoading(false));
    loadStats();
  }, []);

  // --- Add user ---
  const openAddUser = () => {
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setNewRole("editor");
    setAddUserOpen(true);
  };

  const handleAddUser = async () => {
    if (!newEmail || !newPassword) return;
    setAddingUser(true);
    try {
      await api.adminCreateUser(newEmail, newPassword, newName, newRole);
      setAddUserOpen(false);
      await refresh();
      setToast({ message: "User created", variant: "success" });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    } finally {
      setAddingUser(false);
    }
  };

  // --- Edit user ---
  const openEditUser = (user: AdminUser) => {
    setEditUser(user);
    setEditName(user.name);
    setEditRole(user.role as Role);
    setEditPw("");
  };

  const handleSaveUser = async () => {
    if (!editUser) return;
    setEditSaving(true);
    try {
      if (editName !== editUser.name) {
        await api.adminUpdateName(editUser.id, editName);
      }
      if (editRole !== editUser.role) {
        await api.adminUpdateRole(editUser.id, editRole);
      }
      if (editPw) {
        await api.adminResetPassword(editUser.id, editPw);
      }
      setEditUser(null);
      await refresh();
      setToast({ message: "User updated", variant: "success" });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleAssignGroup = async (userId: number, groupId: number) => {
    try {
      await api.adminAssignGroup(userId, groupId);
      await refresh();
      // Update the edit modal user in place
      setEditUser((prev) => {
        if (!prev || prev.id !== userId) return prev;
        const g = groups.find((g) => g.id === groupId);
        if (!g) return prev;
        return { ...prev, groups: [...prev.groups, { id: g.id, name: g.name }] };
      });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  const handleRemoveGroup = async (userId: number, groupId: number) => {
    try {
      await api.adminRemoveGroup(userId, groupId);
      await refresh();
      setEditUser((prev) => {
        if (!prev || prev.id !== userId) return prev;
        return { ...prev, groups: prev.groups.filter((g) => g.id !== groupId) };
      });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  // --- Add group ---
  const openAddGroup = () => {
    setNewGroupName("");
    setAddGroupOpen(true);
  };

  const handleAddGroup = async () => {
    if (!newGroupName) return;
    setAddingGroup(true);
    try {
      await api.adminCreateGroup(newGroupName);
      setAddGroupOpen(false);
      await refresh();
      setToast({ message: "Group created", variant: "success" });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    } finally {
      setAddingGroup(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    if (!deleteModal) return;
    try {
      if (deleteModal.type === "user") {
        await api.adminDeleteUser(deleteModal.id);
      } else {
        await api.adminDeleteGroup(deleteModal.id);
      }
      setDeleteModal(null);
      await refresh();
      setToast({ message: `${deleteModal.type === "user" ? "User" : "Group"} deleted`, variant: "success" });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  if (loading) return <AdminSkeleton title="Admin" />;

  const TABS: { key: Tab; label: string }[] = [
    { key: "users", label: "Users" },
    { key: "groups", label: "Groups" },
    { key: "usage", label: "Usage" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Admin</h1>
        {/* Role key */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-gray-400">
          <span><span className="text-gray-300">readonly</span> view</span>
          <span><span className="text-gray-300">editor</span> edit & tag</span>
          <span><span className="text-gray-300">admin</span> upload & delete</span>
          <span><span className="text-gray-300">superadmin</span> manage users</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition -mb-px ${
              tab === t.key
                ? "border-b-2 border-accent-500 text-accent-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* === Users Tab === */}
      {tab === "users" && (
        <section>
          <div className="mb-3 flex justify-end">
            <button
              onClick={openAddUser}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Add User
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs text-gray-400">
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Groups</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-900/50">
                    <td className="px-3 py-2 text-white">{user.email}</td>
                    <td className="px-3 py-2 text-gray-300">{user.name || <span className="text-gray-600">—</span>}</td>
                    <td className="px-3 py-2 text-gray-300">{user.role}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {user.groups.map((g) => (
                          <span
                            key={g.id}
                            className="rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-300"
                          >
                            {g.name}
                          </span>
                        ))}
                        {user.groups.length === 0 && (
                          <span className="text-xs text-gray-600">None</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditUser(user)}
                          className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteModal({ type: "user", id: user.id, name: user.email })}
                          className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950 hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-gray-500">No users yet.</p>
            )}
          </div>
        </section>
      )}

      {/* === Groups Tab === */}
      {tab === "groups" && (
        <section>
          <div className="mb-3 flex justify-end">
            <button
              onClick={openAddGroup}
              className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Add Group
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs text-gray-400">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Members</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {groups.map((group) => (
                  <tr key={group.id} className="hover:bg-gray-900/50">
                    <td className="px-3 py-2 text-white">{group.name}</td>
                    <td className="px-3 py-2 text-gray-300">
                      {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setDeleteModal({ type: "group", id: group.id, name: group.name })}
                        className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950 hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {groups.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-gray-500">No groups yet.</p>
            )}
          </div>
        </section>
      )}

      {/* === Usage Tab === */}
      {tab === "usage" && (
        <section className="space-y-6">
          {statsError && <p className="text-sm text-red-400">{statsError}</p>}
          {!stats && !statsError && <p className="text-sm text-gray-500">Loading...</p>}
          {stats && (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs text-gray-400">
                      <th className="px-3 py-2 font-medium">User</th>
                      <th className="px-3 py-2 font-medium">Last active</th>
                      {EVENT_TYPES.map((t) => (
                        <th key={t} className="px-3 py-2 text-center font-medium">{eventLabel(t)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {stats.users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-900/50">
                        <td className="px-3 py-2 text-white">{u.name || u.email}</td>
                        <td className="px-3 py-2 text-gray-400">{relativeTime(u.last_active_at)}</td>
                        {EVENT_TYPES.map((t) => (
                          <td key={t} className="px-3 py-2 text-center text-gray-300">
                            {u.event_counts[t] || 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold text-gray-300">Recent Activity</h2>
                {stats.recent_activity.length === 0 ? (
                  <p className="text-sm text-gray-500">No activity yet.</p>
                ) : (
                  <div className="space-y-1">
                    {stats.recent_activity.map((a, i) => (
                      <div key={i} className="flex items-baseline gap-2 rounded px-3 py-1.5 text-sm hover:bg-gray-900/50">
                        <span className="text-xs text-gray-500 whitespace-nowrap">{formatTimestamp(a.created_at)}</span>
                        <span className="text-gray-300">
                          <span className="font-medium text-white">{a.user_name}</span>
                          {" "}{eventAction(a.event_type)}
                          {a.detail && <span className="text-accent-400"> {a.detail}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* Add user modal */}
      <FormModal
        open={addUserOpen}
        title="Add User"
        confirmLabel="Add User"
        confirmLoading={addingUser}
        onConfirm={handleAddUser}
        onCancel={() => setAddUserOpen(false)}
      >
        <input
          type="text"
          placeholder="Username"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          required
          autoFocus
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <input
          type="text"
          placeholder="Name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <input
          type="password"
          placeholder="Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </FormModal>

      {/* Edit user modal */}
      <FormModal
        open={editUser !== null}
        title={`Edit ${editUser?.email ?? ""}`}
        confirmLabel="Save"
        confirmLoading={editSaving}
        onConfirm={handleSaveUser}
        onCancel={() => setEditUser(null)}
      >
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Name</label>
          <input
            type="text"
            placeholder="Display name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
          <select
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as Role)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Groups</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {editUser?.groups.map((g) => (
              <span
                key={g.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300"
              >
                {g.name}
                <button
                  type="button"
                  onClick={() => handleRemoveGroup(editUser.id, g.id)}
                  className="ml-0.5 text-gray-500 hover:text-red-400"
                >
                  &times;
                </button>
              </span>
            ))}
            {editUser && groups.filter((g) => !editUser.groups.some((ug) => ug.id === g.id)).length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleAssignGroup(editUser.id, Number(e.target.value));
                }}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-gray-400 focus:border-accent-500 focus:outline-none"
              >
                <option value="">+ Group</option>
                {groups
                  .filter((g) => !editUser.groups.some((ug) => ug.id === g.id))
                  .map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
              </select>
            )}
            {editUser?.groups.length === 0 && groups.filter((g) => !editUser.groups.some((ug) => ug.id === g.id)).length === 0 && (
              <span className="text-xs text-gray-500">No groups available</span>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Reset Password</label>
          <input
            type="password"
            placeholder="New password (leave blank to keep)"
            value={editPw}
            onChange={(e) => setEditPw(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
          />
        </div>
      </FormModal>

      {/* Add group modal */}
      <FormModal
        open={addGroupOpen}
        title="Add Group"
        confirmLabel="Add Group"
        confirmLoading={addingGroup}
        onConfirm={handleAddGroup}
        onCancel={() => setAddGroupOpen(false)}
      >
        <input
          type="text"
          placeholder="Group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          required
          autoFocus
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
        />
      </FormModal>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteModal !== null}
        title={`Delete ${deleteModal?.type ?? ""}`}
        message={
          deleteModal?.type === "group"
            ? `Delete "${deleteModal.name}"? This will permanently delete all recordings, songs, and tracks in this group.`
            : `Delete user "${deleteModal?.name ?? ""}"?`
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteModal(null)}
      />

      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
