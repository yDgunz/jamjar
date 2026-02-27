import { useEffect, useState } from "react";

interface EditableFieldProps {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
  readOnly?: boolean;
  rows?: number;
  onSave: (val: string) => void;
}

export default function EditableField({
  label,
  value,
  placeholder,
  mono,
  readOnly,
  rows = 3,
  onSave,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(value);

  useEffect(() => {
    setInput(value);
  }, [value]);

  const handleSave = () => {
    setEditing(false);
    if (input.trim() !== value) {
      onSave(input.trim());
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setInput(value);
  };

  return (
    <div>
      {label && (
        <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}
        </label>
      )}
      {editing && !readOnly ? (
        <div>
          <textarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) { e.preventDefault(); handleSave(); }
              if (e.key === "Escape") handleCancel();
            }}
            rows={rows}
            className={`w-full rounded border border-gray-700 bg-gray-800 px-2 py-1 text-base sm:text-sm text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none ${mono ? "font-mono" : ""}`}
            placeholder={placeholder}
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              onMouseDown={(e) => { e.preventDefault(); handleSave(); }}
              className="rounded bg-accent-600 px-3 py-1.5 text-xs text-white hover:bg-accent-500"
            >
              Save
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); handleCancel(); }}
              className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <span className="hidden text-xs text-gray-600 sm:inline">⌘Enter to save · Esc to cancel</span>
          </div>
        </div>
      ) : value ? (
        readOnly ? (
          mono ? (
            <div className="overflow-x-auto">
              <p className="text-base sm:text-sm text-gray-300 font-mono whitespace-pre">{value}</p>
            </div>
          ) : (
            <p className="text-base sm:text-sm text-gray-300 whitespace-pre-wrap">{value}</p>
          )
        ) : (
          mono ? (
            <div className="overflow-x-auto">
              <button
                onClick={() => setEditing(true)}
                className="text-left text-base sm:text-sm text-gray-300 hover:text-white font-mono whitespace-pre"
              >
                {value}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-left text-base sm:text-sm text-gray-300 hover:text-white whitespace-pre-wrap"
            >
              {value}
            </button>
          )
        )
      ) : readOnly ? null : (
        <button
          onClick={() => setEditing(true)}
          className="text-sm text-gray-600 hover:text-gray-400"
        >
          + {placeholder.toLowerCase()}
        </button>
      )}
    </div>
  );
}
