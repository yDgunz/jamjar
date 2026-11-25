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

export interface ArtistGroup<T> {
  /** "" for the songs that have no artist. */
  name: string;
  songs: T[];
}

/** Songs grouped by artist, most songs first (ties by name); songs without an artist come last. */
export function groupByArtist<T extends { name: string; artist?: string | null }>(songs: T[]): ArtistGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const s of songs) {
    const key = s.artist ?? "";
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return [...groups.entries()]
    .map(([name, list]) => ({ name, songs: list }))
    .sort((a, b) =>
      Number(a.name === "") - Number(b.name === "")
      || b.songs.length - a.songs.length
      || sortName(a.name).localeCompare(sortName(b.name)));
}
