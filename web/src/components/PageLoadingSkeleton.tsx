import type { ReactNode } from "react";

function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-800 ${className}`} />;
}

/** Skeleton for list pages (SessionList, SongCatalog, SetlistList) */
export function ListSkeleton({ toolbar, cards = 4, rightSide }: {
  toolbar?: ReactNode;
  cards?: number;
  rightSide?: "two-lines" | "one-line";
}) {
  return (
    <div>
      {toolbar ?? (
        <div className="mb-3 flex items-center gap-2">
          <Bone className="h-8 w-44" />
          <Bone className="ml-auto h-8 w-24" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4">
            <div className="space-y-2">
              <Bone className="h-5 w-48" />
              <Bone className="h-4 w-32" />
            </div>
            {rightSide === "two-lines" ? (
              <div className="space-y-1 text-right">
                <Bone className="h-4 w-16" />
                <Bone className="h-4 w-20" />
              </div>
            ) : (
              <Bone className="h-4 w-16" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for detail pages (SessionDetail, SongHistory, SetlistDetail) */
export function DetailSkeleton({ trackCount = 3, showDivider, metaBlock }: {
  trackCount?: number;
  showDivider?: boolean;
  metaBlock?: ReactNode;
}) {
  return (
    <div>
      <Bone className="h-4 w-24" />
      <div className="mt-4 mb-6 space-y-2">
        <Bone className="h-8 w-64" />
        <Bone className="h-4 w-48" />
      </div>
      {metaBlock}
      {showDivider && (
        <div className="mb-3 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-700" />
          <Bone className="h-4 w-12" />
          <div className="h-px flex-1 bg-gray-700" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: trackCount }, (_, i) => (
          <div key={i} className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <Bone className="h-5 w-32" />
              <Bone className="h-4 w-20" />
            </div>
            <Bone className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for admin page */
export function AdminSkeleton({ title, count = 3 }: { title: string; count?: number }) {
  return (
    <div>
      <h1 className="mb-6 text-lg font-bold">{title}</h1>
      <div className="space-y-4">
        {Array.from({ length: count }, (_, i) => (
          <Bone key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
