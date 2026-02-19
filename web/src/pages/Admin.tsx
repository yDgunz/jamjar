import { useEffect, useState } from "react";
import { api, isSuperAdmin } from "../api";
import type { AdminUser, AdminGroup, Role } from "../api";
import Modal, { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";

const ROLES: Role[] = ["readonly", "editor", "admin", "superadmin"];

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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; variant: "error" | "success" } | null>(null);

  // Add user modal
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("editor");
  const [addingUser, setAddingUser] = useState(false);

  // Add group modal
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);

  // Reset password
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPw] = useState("");

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

  useEffect(() => {
    refresh().then(() => setLoading(false));
  }, []);

  const openAddUser = () => {
    setNewEmail("");
    setNewName("");
    setNewPassword("");
    setNewRole("editor");
    setAddUserOpen(true);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const openAddGroup = () => {
    setNewGroupName("");
    setAddGroupOpen(true);
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
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

  const handleResetPassword = async (userId: number) => {
    if (!resetPassword) return;
    try {
      await api.adminResetPassword(userId, resetPassword);
      setResetUserId(null);
      setResetPw("");
      setToast({ message: "Password reset", variant: "success" });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  const handleAssignGroup = async (userId: number, groupId: number) => {
    try {
      await api.adminAssignGroup(userId, groupId);
      await refresh();
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  const handleRoleChange = async (userId: number, role: string) => {
    try {
      await api.adminUpdateRole(userId, role);
      await refresh();
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  const handleRemoveGroup = async (userId: number, groupId: number) => {
    try {
      await api.adminRemoveGroup(userId, groupId);
      await refresh();
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="mb-6 text-lg font-bold">Admin</h1>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <h1 className="text-lg font-bold">Admin</h1>

      {/* --- Users Section --- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200">Users</h2>
          <button
            onClick={openAddUser}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Add User
          </button>
        </div>

        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-white">{user.email}</span>
                  {user.name && (
                    <span className="ml-2 text-sm text-gray-400">{user.name}</span>
                  )}
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value)}
                    className="ml-2 rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-gray-300 focus:border-indigo-500 focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  {user.groups.map((g) => (
                    <span
                      key={g.id}
                      className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-300"
                    >
                      {g.name}
                      <button
                        onClick={() => handleRemoveGroup(user.id, g.id)}
                        className="ml-0.5 text-gray-500 hover:text-red-400"
                        title={`Remove from ${g.name}`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  {groups.filter((g) => !user.groups.some((ug) => ug.id === g.id)).length > 0 && (
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleAssignGroup(user.id, Number(e.target.value));
                      }}
                      className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-gray-400 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="">+ Group</option>
                      {groups
                        .filter((g) => !user.groups.some((ug) => ug.id === g.id))
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {resetUserId === user.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleResetPassword(user.id);
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPassword}
                        onChange={(e) => setResetPw(e.target.value)}
                        required
                        autoFocus
                        className="w-32 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-500"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setResetUserId(null);
                          setResetPw("");
                        }}
                        className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setResetUserId(user.id)}
                      className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
                    >
                      Reset pw
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setDeleteModal({ type: "user", id: user.id, name: user.email })
                    }
                    className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-sm text-gray-500">No users yet.</p>
          )}
        </div>
      </section>

      {/* --- Groups Section --- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-200">Groups</h2>
          <button
            onClick={openAddGroup}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            Add Group
          </button>
        </div>

        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3"
            >
              <div>
                <span className="font-medium text-white">{group.name}</span>
                <span className="ml-3 text-sm text-gray-400">
                  {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() =>
                  setDeleteModal({ type: "group", id: group.id, name: group.name })
                }
                className="rounded px-2 py-1 text-xs text-red-400 transition hover:bg-red-950 hover:text-red-300"
              >
                Delete
              </button>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-sm text-gray-500">No groups yet.</p>
          )}
        </div>
      </section>

      {/* Add user modal */}
      {addUserOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={(e) => { if (e.key === "Escape") setAddUserOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setAddUserOpen(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
            <h3 className="text-sm font-semibold text-white">Add User</h3>
            <form onSubmit={handleAddUser} className="mt-4 space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoFocus
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <input
                type="password"
                placeholder="Password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddUserOpen(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add group modal */}
      {addGroupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onKeyDown={(e) => { if (e.key === "Escape") setAddGroupOpen(false); }}
        >
          <div className="absolute inset-0 bg-black/60" onClick={() => setAddGroupOpen(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 px-6 py-5 shadow-xl">
            <h3 className="text-sm font-semibold text-white">Add Group</h3>
            <form onSubmit={handleAddGroup} className="mt-4 space-y-3">
              <input
                type="text"
                placeholder="Group name"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                required
                autoFocus
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
              />
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setAddGroupOpen(false)}
                  className="rounded px-4 py-2 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingGroup}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  Add Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
