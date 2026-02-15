import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { Song } from "../api";

export default function SongCatalog() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listSongs().then((data) => {
      setSongs(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-gray-400">Loading songs...</p>;

  if (songs.length === 0) {
    return (
      <p className="text-gray-400">
        No songs tagged yet. Tag tracks from a{" "}
        <Link to="/" className="text-indigo-400 hover:text-indigo-300">session</Link> to build your catalog.
      </p>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Song Catalog</h1>
      <div className="space-y-3">
        {songs.map((song) => (
          <Link
            key={song.id}
            to={`/songs/${song.id}`}
            className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 transition hover:border-indigo-500 hover:bg-gray-800"
          >
            <div>
              <div className="font-medium text-white">{song.name}</div>
              <div className="mt-1 text-sm text-gray-400">
                {song.last_date
                  ? `Last played ${song.last_date}`
                  : "No date info"}
              </div>
            </div>
            <div className="text-right text-sm text-gray-400">
              {song.take_count} take{song.take_count !== 1 ? "s" : ""}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
