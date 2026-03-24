/** Inline error banner with a retry button. Replaces the skeleton when a page load fails. */
export default function FetchError({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-6 text-center">
      <p className="text-sm text-red-400">{error}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded bg-gray-800 px-4 py-1.5 text-sm text-gray-200 hover:bg-gray-700"
      >
        Retry
      </button>
    </div>
  );
}
