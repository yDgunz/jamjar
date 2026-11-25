/** Filter value for songs that have no artist set. */
export const NO_ARTIST = "\u0000none";

export interface ArtistCount {
  name: string;
  count: number;
}

/** Name to sort by: lower-case, without a leading "The". */
export function sortName(name: string): string {
  return name.toLowerCase().replace(/^the\s+/, "");
}

/** Artists with their song counts, most songs first (ties by name). */
export function countArtists(songs: { artist?: string | null }[]): { artists: ArtistCount[]; none: number } {
  const counts = new Map<string, number>();
  let none = 0;
  for (const s of songs) {
    if (s.artist) counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
    else none++;
  }
  const artists = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || sortName(a.name).localeCompare(sortName(b.name)));
  return { artists, none };
}
