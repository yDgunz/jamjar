import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import {
  api,
  formatDate,
  formatDateTime,
  formatTime,
  utcToLocal,
  localToUtc,
  canEdit,
  canAdmin,
} from "../api";
import type { Event, EventMemberResponse } from "../api";
import EditableField from "../components/EditableField";
import Modal, { Toast } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { DetailSkeleton } from "../components/PageLoadingSkeleton";

const STATUS_BADGE: Record<string, string> = {
  tentative: "bg-yellow-900/50 text-yellow-400",
  confirmed: "bg-green-900/50 text-green-400",
  cancelled: "bg-red-900/50 text-red-400",
};

const RSVP_COLORS: Record<string, string> = {
  yes: "text-green-400",
  no: "text-red-400",
  maybe: "text-yellow-400",
  pending: "text-gray-500",
};

const RSVP_BUTTON_STYLES: Record<
  string,
  { active: string; inactive: string }
> = {
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

const SORT_ORDER: Record<string, number> = {
  yes: 0,
  maybe: 1,
  pending: 2,
  no: 3,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Get the local date and times from a UTC-stored event */
function getLocalTimes(event: Event) {
  let localDate = event.date;
  let localTime: string | null = null;

  if (event.time) {
    const converted = utcToLocal(event.date, event.time);
    localDate = converted.date;
    localTime = converted.time;
  }
  return { localDate, localTime };
}

export default function ScheduleDetail() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const eventId = Number(id);
  const [event, setEvent] = useState<Event | null>(null);
  const [responses, setResponses] = useState<EventMemberResponse[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [comment, setComment] = useState("");

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [editingTime, setEditingTime] = useState(false);
  const [timeInput, setTimeInput] = useState("");

  const fetchData = async () => {
    try {
      const [ev, resps] = await Promise.all([
        api.getEvent(eventId),
        api.getEventResponses(eventId),
      ]);
      setEvent(ev);
      setNameInput(ev.name);
      const { localDate, localTime } = getLocalTimes(ev);
      setDateInput(localDate);
      setTimeInput(localTime ?? "");
      setResponses(
        resps.sort(
          (a, b) =>
            (SORT_ORDER[a.status] ?? 9) -
            (SORT_ORDER[b.status] ?? 9),
        ),
      );
      const myResp = resps.find((r) => r.user_id === user?.id);
      setComment(myResp?.comment ?? "");
      setLoading(false);
    } catch {
      setErrorMsg("Failed to load event");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const handleRsvp = async (status: string) => {
    if (event?.my_response?.status === status) {
      await api.clearEventResponse(eventId);
    } else {
      await api.respondToEvent(
        eventId,
        status,
        comment || undefined,
      );
    }
    await fetchData();
  };

  const handleUpdateComment = async () => {
    if (!event?.my_response) return;
    await api.respondToEvent(
      eventId,
      event.my_response.status,
      comment || undefined,
    );
    await fetchData();
  };

  const handleSaveName = async () => {
    const name = nameInput.trim();
    if (!name || name === event?.name) {
      setEditingName(false);
      return;
    }
    try {
      const updated = await api.updateEvent(eventId, { name });
      setEvent(updated);
      setEditingName(false);
    } catch (err) {
      setErrorMsg(`Failed to rename: ${err}`);
    }
  };

  const handleSaveDate = async () => {
    const { localDate } = event ? getLocalTimes(event) : { localDate: "" };
    if (dateInput === localDate) {
      setEditingDate(false);
      return;
    }
    try {
      // If event has a time, convert the new date+existing time to UTC
      let utcDate = dateInput;
      if (event?.time) {
        const { localTime } = getLocalTimes(event);
        if (localTime) {
          const utc = localToUtc(dateInput, localTime);
          utcDate = utc.date;
        }
      }
      const updated = await api.updateEvent(eventId, {
        date: utcDate,
      });
      setEvent(updated);
      setEditingDate(false);
    } catch (err) {
      setErrorMsg(`Failed to update date: ${err}`);
    }
  };

  const handleSaveTime = async () => {
    const { localTime } = event ? getLocalTimes(event) : { localTime: null };
    if (timeInput === (localTime ?? "")) {
      setEditingTime(false);
      return;
    }
    try {
      if (timeInput) {
        const utc = localToUtc(dateInput || event!.date, timeInput);
        const updated = await api.updateEvent(eventId, {
          date: utc.date,
          time: utc.time,
        });
        setEvent(updated);
      } else {
        // Clear time
        const updated = await api.updateEvent(eventId, { time: "" });
        setEvent(updated);
      }
      setEditingTime(false);
    } catch (err) {
      setErrorMsg(`Failed to update time: ${err}`);
    }
  };

  const handleUpdateField = async (
    field: string,
    value: string,
  ) => {
    try {
      const updated = await api.updateEvent(eventId, {
        [field]: value,
      });
      setEvent(updated);
    } catch (err) {
      setErrorMsg(`Failed to update: ${err}`);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteEvent(eventId);
      navigate("/schedule");
    } catch (err) {
      setErrorMsg(`Failed to delete: ${err}`);
    }
  };

  if (loading) return <DetailSkeleton />;
  if (!event)
    return (
      <p className="py-12 text-center text-gray-500">
        Event not found
      </p>
    );

  const { localDate, localTime } = getLocalTimes(event);

  return (
    <div>
      {errorMsg && (
        <Toast
          message={errorMsg}
          onClose={() => setErrorMsg(null)}
        />
      )}

      <div className="mb-4 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                event.type === "gig"
                  ? "bg-accent-900 text-accent-300"
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              {event.type}
            </span>
            {canEdit(user) ? (
              <select
                value={event.status}
                onChange={(e) =>
                  handleUpdateField("status", e.target.value)
                }
                className={`rounded border-0 px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]}`}
              >
                <option value="tentative">Tentative</option>
                <option value="confirmed">Confirmed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[event.status]}`}
              >
                {capitalize(event.status)}
              </span>
            )}
          </div>

          {/* Name */}
          {editingName && canEdit(user) ? (
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") {
                  setEditingName(false);
                  setNameInput(event.name);
                }
              }}
              onBlur={handleSaveName}
              className="w-full max-w-lg rounded border border-gray-700 bg-gray-800 px-2 py-1 text-lg font-bold text-white focus:border-accent-500 focus:outline-none"
            />
          ) : (
            <h1
              onClick={() => canEdit(user) && setEditingName(true)}
              className={`text-lg font-bold ${canEdit(user) ? "cursor-pointer hover:text-accent-400" : ""}`}
              title={canEdit(user) ? "Click to rename" : undefined}
            >
              {event.name}
              {event.group_name && user && user.groups.length > 1 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  {event.group_name}
                </span>
              )}
            </h1>
          )}

          {/* Date & Time */}
          <div className="mt-0.5 flex items-center gap-2 text-sm text-gray-400">
            {editingDate && canEdit(user) ? (
              <input
                autoFocus
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveDate();
                  if (e.key === "Escape") {
                    setEditingDate(false);
                    setDateInput(localDate);
                  }
                }}
                onBlur={handleSaveDate}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
              />
            ) : canEdit(user) ? (
              <button
                onClick={() => setEditingDate(true)}
                className="hover:text-accent-400"
                title="Click to change date"
              >
                {formatDate(localDate)}
              </button>
            ) : (
              <span>{formatDate(localDate)}</span>
            )}

            {editingTime && canEdit(user) ? (
              <input
                autoFocus
                type="time"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTime();
                  if (e.key === "Escape") {
                    setEditingTime(false);
                    setTimeInput(localTime ?? "");
                  }
                }}
                onBlur={handleSaveTime}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-base sm:text-sm text-white focus:border-accent-500 focus:outline-none"
              />
            ) : localTime ? (
              canEdit(user) ? (
                <button
                  onClick={() => setEditingTime(true)}
                  className="hover:text-accent-400"
                  title="Click to change time"
                >
                  {formatTime(event.date, event.time)}
                </button>
              ) : (
                <span>
                  {formatTime(event.date, event.time)}
                </span>
              )
            ) : canEdit(user) ? (
              <button
                onClick={() => setEditingTime(true)}
                className="text-gray-600 hover:text-gray-400"
              >
                + Add time
              </button>
            ) : null}
          </div>
          {event.location && (
            <p className="text-sm text-gray-400">
              {event.location}
            </p>
          )}
        </div>
        {canAdmin(user) && (
          <button
            onClick={() => setShowDelete(true)}
            className="shrink-0 rounded px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-900/30"
          >
            Delete
          </button>
        )}
      </div>

      {/* Notes */}
      <div className="mb-6">
        <EditableField
          label="Notes"
          value={event.notes}
          placeholder="Add notes"
          readOnly={!canEdit(user)}
          onSave={(val) => handleUpdateField("notes", val)}
        />
      </div>

      {/* RSVP */}
      <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Your Response
        </h2>
        <div className="flex items-center gap-2">
          {(["yes", "maybe", "no"] as const).map((s) => (
            <button
              key={s}
              onClick={() => handleRsvp(s)}
              className={`rounded px-4 py-1.5 text-sm font-medium transition ${
                event.my_response?.status === s
                  ? RSVP_BUTTON_STYLES[s].active
                  : RSVP_BUTTON_STYLES[s].inactive
              }`}
            >
              {s === "yes"
                ? "Yes"
                : s === "maybe"
                  ? "Maybe"
                  : "No"}
            </button>
          ))}
        </div>
        {event.my_response && (
          <div className="mt-3">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={handleUpdateComment}
              placeholder="Add a comment..."
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500"
            />
          </div>
        )}
      </div>

      {/* Member Responses */}
      <div className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Responses (
          {responses.filter((r) => r.status !== "pending").length}/
          {responses.length})
        </h2>
        <div className="space-y-1">
          {responses.map((r) => (
            <div
              key={r.user_id}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-white">{r.user_name}</span>
                {r.comment && (
                  <span className="text-gray-500">
                    &ndash; {r.comment}
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-medium ${RSVP_COLORS[r.status]}`}
              >
                {capitalize(r.status)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Metadata */}
      {(event.created_by_name || event.updated_by_name) && (
        <div className="text-xs text-gray-600">
          {event.created_by_name && (
            <p>Created by {event.created_by_name}</p>
          )}
          {event.updated_by_name && event.updated_at && (
            <p>
              Updated by {event.updated_by_name} on{" "}
              {formatDateTime(event.updated_at)}
            </p>
          )}
        </div>
      )}

      <Modal
        open={showDelete}
        onClose={() => setShowDelete(false)}
      >
        <p className="text-sm text-gray-300">
          Delete &ldquo;{event.name}&rdquo;? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setShowDelete(false)}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
