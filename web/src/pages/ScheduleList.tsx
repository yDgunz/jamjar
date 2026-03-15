import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { api, formatDate, formatTime, utcToLocal, localToUtc, canEdit } from "../api";
import type { Event } from "../api";
import FormModal from "../components/FormModal";
import GroupSelector from "../components/GroupSelector";
import { ListSkeleton } from "../components/PageLoadingSkeleton";
import { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";

type TypeFilter = "all" | "rehearsal" | "gig";

const TYPE_BADGE: Record<string, string> = {
  rehearsal: "bg-gray-700 text-gray-300",
  gig: "bg-accent-900 text-accent-300",
};

const STATUS_BADGE: Record<string, string> = {
  tentative: "bg-yellow-900/50 text-yellow-400",
  confirmed: "bg-green-900/50 text-green-400",
  cancelled: "bg-red-900/50 text-red-400",
};

const RSVP_STYLES: Record<string, { active: string; inactive: string }> = {
  yes: {
    active: "bg-green-600 text-white",
    inactive:
      "border border-green-700 text-green-400 hover:bg-green-900/50",
  },
  maybe: {
    active: "bg-yellow-600 text-white",
    inactive:
      "border border-yellow-700 text-yellow-400 hover:bg-yellow-900/50",
  },
  no: {
    active: "bg-red-600 text-white",
    inactive:
      "border border-red-700 text-red-400 hover:bg-red-900/50",
  },
};

function RsvpButtons({
  myResponse,
  onRespond,
}: {
  myResponse: string | null;
  onRespond: (status: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {(["yes", "maybe", "no"] as const).map((s) => (
        <button
          key={s}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRespond(s);
          }}
          className={`rounded px-2 py-0.5 text-xs font-medium transition ${
            myResponse === s
              ? RSVP_STYLES[s].active
              : RSVP_STYLES[s].inactive
          }`}
        >
          {s === "yes" ? "Yes" : s === "maybe" ? "Maybe" : "No"}
        </button>
      ))}
    </div>
  );
}

const RESPONSE_COLORS: Record<string, string> = {
  yes: "text-green-400",
  maybe: "text-yellow-400",
  no: "text-red-400",
};

function ResponseSummary({
  responses,
  pending,
}: {
  responses: Event["responses"];
  pending: number;
}) {
  if (!responses.length && !pending) return null;

  const grouped: Record<string, string[]> = { yes: [], maybe: [], no: [] };
  for (const r of responses) {
    const first = r.user_name.split(" ")[0];
    if (grouped[r.status]) grouped[r.status].push(first);
  }

  const parts: React.ReactNode[] = [];
  for (const status of ["yes", "maybe", "no"] as const) {
    if (grouped[status].length) {
      parts.push(
        <span key={status} className={RESPONSE_COLORS[status]}>
          {grouped[status].join(", ")}
        </span>,
      );
    }
  }
  if (pending > 0) {
    parts.push(
      <span key="pending" className="text-gray-600">
        {pending} pending
      </span>,
    );
  }

  return (
    <span className="flex flex-wrap gap-x-2 text-xs">
      {parts}
    </span>
  );
}

export default function ScheduleList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showPast, setShowPast] = useState(false);
  const [groupFilter, setGroupFilter] = useState<number | null>(() => {
    const stored = localStorage.getItem("group-filter");
    if (stored) {
      const n = Number(stored);
      if (!isNaN(n)) return n;
    }
    return null;
  });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("rehearsal");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newGroupId, setNewGroupId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEvents = () => {
    const typeParam = typeFilter === "all" ? undefined : typeFilter;
    api.listEvents(typeParam, showPast).then((data) => {
      setEvents(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    setLoading(true);
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, showPast]);

  const filtered = useMemo(() => {
    if (groupFilter === null) return events;
    return events.filter((e) => e.group_id === groupFilter);
  }, [events, groupFilter]);

  // Group events by month
  const grouped = useMemo(() => {
    const groups: Record<string, Event[]> = {};
    for (const e of filtered) {
      const month = e.date.slice(0, 7);
      if (!groups[month]) groups[month] = [];
      groups[month].push(e);
    }
    return Object.entries(groups).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [filtered]);

  const defaultGroupId =
    user && user.groups.length === 1 ? user.groups[0].id : null;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setErrorMsg("Event name is required");
      return;
    }
    if (!newDate) {
      setErrorMsg("Date is required");
      return;
    }
    const groupId = newGroupId ?? defaultGroupId;
    if (!groupId) {
      setErrorMsg("Please select a group");
      return;
    }
    try {
      let eventDate = newDate;
      let eventTime: string | undefined;
      if (newTime) {
        const utc = localToUtc(newDate, newTime);
        eventDate = utc.date;
        eventTime = utc.time;
      }
      const event = await api.createEvent({
        group_id: groupId,
        type: newType,
        name,
        date: eventDate,
        time: eventTime,
        location: newLocation || undefined,
      });
      navigate(`/schedule/${event.id}`);
    } catch (err) {
      setErrorMsg(
        `Failed to create event: ${err instanceof Error ? err.message : err}`,
      );
    }
  };

  const handleRsvp = async (eventId: number, status: string) => {
    const event = events.find((e) => e.id === eventId);
    if (event?.my_response?.status === status) {
      await api.clearEventResponse(eventId);
    } else {
      await api.respondToEvent(eventId, status);
    }
    fetchEvents();
  };

  const formatMonth = (ym: string) => {
    const [y, m] = ym.split("-");
    const d = new Date(Number(y), Number(m) - 1);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  };

  if (loading) return <ListSkeleton cards={4} />;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GroupSelector
          groups={user?.groups ?? []}
          value={groupFilter}
          onChange={setGroupFilter}
          allLabel="All groups"
        />
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as TypeFilter)
          }
          className="rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-300"
        >
          <option value="all">All types</option>
          <option value="rehearsal">Rehearsals</option>
          <option value="gig">Gigs</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800"
          />
          Show past
        </label>
        <div className="flex-1" />
        {canEdit(user) && (
          <button
            onClick={() => {
              setCreating(true);
              setNewName("");
              setNewDate("");
              setNewTime("");
              setNewLocation("");
              setNewType("rehearsal");
              setNewGroupId(defaultGroupId);
              setErrorMsg(null);
            }}
            className="rounded bg-accent-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            New Event
          </button>
        )}
      </div>

      <FormModal
        open={creating && canEdit(user) === true}
        title="New Event"
        error={errorMsg}
        confirmLabel="Create"
        onConfirm={handleCreate}
        onCancel={() => setCreating(false)}
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Event name"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
          autoFocus
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300"
        >
          <option value="rehearsal">Rehearsal</option>
          <option value="gig">Gig</option>
        </select>
        <input
          type="date"
          value={newDate}
          onChange={(e) => setNewDate(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
        <input
          type="text"
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          placeholder="Location (optional)"
          className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
        />
        {user && user.groups.length > 1 && (
          <select
            value={newGroupId ?? ""}
            onChange={(e) => setNewGroupId(Number(e.target.value))}
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-300"
          >
            <option value="">Select group...</option>
            {user.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </FormModal>

      {filtered.length === 0 && !creating ? (
        <p className="py-12 text-center text-gray-500">
          No upcoming events. Create one to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([month, monthEvents]) => (
            <div key={month}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                {formatMonth(month)}
              </h3>
              <div className="space-y-2">
                {monthEvents.map((event) => (
                  <Link
                    key={event.id}
                    to={`/schedule/${event.id}`}
                    className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 transition hover:border-accent-500 hover:bg-gray-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${TYPE_BADGE[event.type]}`}
                        >
                          {event.type}
                        </span>
                        <span className="truncate font-medium text-white">
                          {event.name}
                        </span>
                        {user && user.groups.length > 1 && event.group_name && (
                          <span className="text-[10px] text-gray-500">
                            {event.group_name}
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]}`}
                        >
                          {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-sm text-gray-400">
                        <span>{formatDate(event.time ? utcToLocal(event.date, event.time).date : event.date)}</span>
                        {event.time && <span>{formatTime(event.date, event.time)}</span>}
                        {event.location && (
                          <span className="truncate">
                            {event.location}
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <ResponseSummary
                          responses={event.responses}
                          pending={event.response_summary?.pending ?? 0}
                        />
                      </div>
                    </div>
                    <div className="ml-3 shrink-0">
                      <RsvpButtons
                        myResponse={
                          event.my_response?.status ?? null
                        }
                        onRespond={(s) => handleRsvp(event.id, s)}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
