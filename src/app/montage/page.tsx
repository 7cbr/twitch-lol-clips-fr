"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { TwitchClip, ClipsApiResponse } from "@/types/twitch";
import StreamerFilter from "@/components/StreamerFilter";
import { formatDate, formatDayLabel, formatDuration, formatFollowers } from "@/lib/format";
import { getFFmpeg, concatenateClips, ConcatInput } from "@/lib/ffmpeg";

type MontageStatus = "idle" | "loading-ffmpeg" | "downloading" | "concatenating" | "done" | "error";
type SortMode = "views-desc" | "views-asc" | "date-desc" | "date-asc";

export default function MontagePage() {
  const [clips, setClips] = useState<TwitchClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({});
  const [filterDate, setFilterDate] = useState("");
  const [filterStreamers, setFilterStreamers] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("views-desc");
  const [hourFrom, setHourFrom] = useState<string>("");
  const [hourTo, setHourTo] = useState<string>("");

  // Timeline: ordered selection
  const [timeline, setTimeline] = useState<TwitchClip[]>([]);
  const timelineIds = useMemo(() => new Set(timeline.map((c) => c.id)), [timeline]);

  // Montage generation
  const [status, setStatus] = useState<MontageStatus>("idle");
  const [dlProgress, setDlProgress] = useState({ done: 0, total: 0 });
  const [concatProgress, setConcatProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Drag & drop
  const dragIdx = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Fetch clips
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/clips");
        const data: ClipsApiResponse = await res.json();
        setClips(data.clips ?? []);
        setFollowerCounts(data.followerCounts ?? {});
      } catch (err) {
        console.error("Failed to fetch clips:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Derived data
  const streamerNames = useMemo(() => {
    const names = [...new Set(clips.map((c) => c.broadcaster_name))];
    names.sort((a, b) => a.localeCompare(b, "fr"));
    return names;
  }, [clips]);

  const streamerFollowersByName = useMemo(() => {
    const map: Record<string, number> = {};
    for (const clip of clips) {
      if (followerCounts[clip.broadcaster_id] != null && !(clip.broadcaster_name in map)) {
        map[clip.broadcaster_name] = followerCounts[clip.broadcaster_id];
      }
    }
    return map;
  }, [clips, followerCounts]);

  const clipCountsByStreamer = useMemo(() => {
    const map: Record<string, number> = {};
    for (const clip of clips) {
      map[clip.broadcaster_name] = (map[clip.broadcaster_name] ?? 0) + 1;
    }
    return map;
  }, [clips]);

  const availableDates = useMemo(() => {
    const dates = [...new Set(clips.map((c) => new Date(c.created_at).toISOString().slice(0, 10)))];
    dates.sort((a, b) => b.localeCompare(a));
    return dates;
  }, [clips]);

  const filteredClips = useMemo(() => {
    let filtered = clips;
    if (filterDate) {
      filtered = filtered.filter((c) => new Date(c.created_at).toISOString().slice(0, 10) === filterDate);
    }
    if (filterStreamers.length > 0) {
      const set = new Set(filterStreamers);
      filtered = filtered.filter((c) => set.has(c.broadcaster_name));
    }
    if (hourFrom !== "") {
      const from = parseInt(hourFrom, 10);
      filtered = filtered.filter((c) => new Date(c.created_at).getHours() >= from);
    }
    if (hourTo !== "") {
      const to = parseInt(hourTo, 10);
      filtered = filtered.filter((c) => new Date(c.created_at).getHours() <= to);
    }
    switch (sortMode) {
      case "views-desc":
        return filtered.sort((a, b) => b.view_count - a.view_count);
      case "views-asc":
        return filtered.sort((a, b) => a.view_count - b.view_count);
      case "date-desc":
        return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case "date-asc":
        return filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      default:
        return filtered;
    }
  }, [clips, filterDate, filterStreamers, sortMode, hourFrom, hourTo]);

  const totalDuration = useMemo(() => timeline.reduce((sum, c) => sum + c.duration, 0), [timeline]);

  // Actions
  function toggleClip(clip: TwitchClip) {
    if (timelineIds.has(clip.id)) {
      setTimeline((prev) => prev.filter((c) => c.id !== clip.id));
    } else {
      setTimeline((prev) => [...prev, clip]);
    }
  }

  function removeFromTimeline(clipId: string) {
    setTimeline((prev) => prev.filter((c) => c.id !== clipId));
  }

  function handleDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  function handleDrop(idx: number) {
    const from = dragIdx.current;
    if (from === null || from === idx) {
      dragIdx.current = null;
      setDragOverIdx(null);
      return;
    }
    setTimeline((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    dragIdx.current = null;
    setDragOverIdx(null);
  }

  function handleDragEnd() {
    dragIdx.current = null;
    setDragOverIdx(null);
  }

  async function handleGenerate() {
    if (timeline.length < 2) return;

    setStatus("loading-ffmpeg");
    setErrorMessage(null);
    setConcatProgress(0);

    try {
      const ffmpeg = await getFFmpeg((ratio) => setConcatProgress(ratio));

      setStatus("downloading");
      setDlProgress({ done: 0, total: timeline.length });

      const inputs: ConcatInput[] = [];
      for (let i = 0; i < timeline.length; i++) {
        const clip = timeline[i];
        const res = await fetch(`/api/download?slug=${encodeURIComponent(clip.id)}`);
        if (!res.ok) throw new Error(`Echec du telechargement: ${clip.title}`);
        const buffer = await res.arrayBuffer();
        inputs.push({ filename: `clip${i}.mp4`, data: new Uint8Array(buffer), streamerName: clip.broadcaster_name });
        setDlProgress({ done: i + 1, total: timeline.length });
      }

      setStatus("concatenating");
      setConcatProgress(0);
      const blob = await concatenateClips(ffmpeg, inputs);

      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Erreur inconnue");
      setStatus("error");
    }
  }

  function handleDownloadResult() {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `montage-${timeline.length}clips.mp4`;
    a.click();
  }

  function handleReset() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setStatus("idle");
    setErrorMessage(null);
    setConcatProgress(0);
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e10] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Chargement des clips...</p>
        </div>
      </div>
    );
  }

  const isProcessing = status !== "idle" && status !== "done" && status !== "error";

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      {/* Header */}
      <header className="px-6 pt-5 pb-4">
        <div className="max-w-[1600px] mx-auto">
          <h1 className="text-2xl font-bold">Montage</h1>
          <p className="text-sm text-gray-400 mt-1">
            Selectionnez des clips puis generez un montage MP4
          </p>
        </div>
      </header>

      <div className="px-6 pb-6">
        <div className="max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-5">
          {/* Left: Clip selection */}
          <div className="flex-1 min-w-0">
            <div className="mb-3 space-y-2">
              <StreamerFilter
                allStreamers={streamerNames}
                selected={filterStreamers}
                onChange={setFilterStreamers}
                followerCounts={streamerFollowersByName}
                clipCounts={clipCountsByStreamer}
              />
              <div className="flex gap-2">
                <select
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="flex-1 bg-[#18181b] text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">Toutes les dates</option>
                  {availableDates.map((d) => (
                    <option key={d} value={d}>{formatDayLabel(d)}</option>
                  ))}
                </select>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="flex-1 bg-[#18181b] text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="views-desc">Plus vus</option>
                  <option value="views-asc">Moins vus</option>
                  <option value="date-desc">Plus recents</option>
                  <option value="date-asc">Plus anciens</option>
                </select>
              </div>
              {/* Time range filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 shrink-0">Heure :</span>
                <select
                  value={hourFrom}
                  onChange={(e) => setHourFrom(e.target.value)}
                  className="flex-1 bg-[#18181b] text-gray-300 text-xs rounded-lg px-2 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">De...</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>{String(i).padStart(2, "0")}h00</option>
                  ))}
                </select>
                <span className="text-xs text-gray-600">→</span>
                <select
                  value={hourTo}
                  onChange={(e) => setHourTo(e.target.value)}
                  className="flex-1 bg-[#18181b] text-gray-300 text-xs rounded-lg px-2 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none"
                >
                  <option value="">A...</option>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>{String(i).padStart(2, "0")}h59</option>
                  ))}
                </select>
                {(hourFrom !== "" || hourTo !== "") && (
                  <button
                    onClick={() => { setHourFrom(""); setHourTo(""); }}
                    className="text-gray-500 hover:text-gray-300 transition-colors"
                    title="Reinitialiser"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{filteredClips.length} clips disponibles</span>
              {timeline.length > 0 && (
                <span className="text-xs text-purple-400">{timeline.length} selectionne{timeline.length > 1 ? "s" : ""}</span>
              )}
            </div>

            <div className="space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
              {filteredClips.map((clip) => {
                const inTimeline = timelineIds.has(clip.id);
                const orderNum = inTimeline ? timeline.findIndex((c) => c.id === clip.id) + 1 : null;

                return (
                  <button
                    key={clip.id}
                    onClick={() => toggleClip(clip)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg transition-colors text-left ${
                      inTimeline
                        ? "bg-purple-900/30 border border-purple-500/40"
                        : "hover:bg-[#18181b]"
                    }`}
                  >
                    {/* Order badge or add icon */}
                    <div className="shrink-0 w-6 h-6 flex items-center justify-center">
                      {inTimeline ? (
                        <span className="w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center">
                          {orderNum}
                        </span>
                      ) : (
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                    </div>

                    {/* Thumbnail */}
                    <div className="relative w-[100px] h-[56px] shrink-0 rounded overflow-hidden bg-gray-800">
                      <img src={clip.thumbnail_url} alt={clip.title} className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded flex items-center gap-0.5">
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                        {clip.view_count}
                      </span>
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white line-clamp-2 leading-tight">{clip.title}</p>
                      <p className="text-xs text-white mt-1 flex items-center gap-1.5">
                        {clip.broadcaster_name}
                        {followerCounts[clip.broadcaster_id] != null && (
                          <span className="text-purple-400 flex items-center gap-0.5">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 17v1h-3zM4.75 14.094A5.973 5.973 0 004 17v1H1v-1a3 3 0 013.75-2.906z" />
                            </svg>
                            {formatFollowers(followerCounts[clip.broadcaster_id])}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500">
                        {clip.creator_name} · {formatDate(clip.created_at)} · <span className="text-gray-400">{formatDuration(clip.duration)}</span>
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Timeline + Generation */}
          <div className="w-full lg:w-[420px] shrink-0">
            <div className="sticky top-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-2 flex items-center justify-between">
                <span>Timeline ({timeline.length} clips)</span>
                {totalDuration > 0 && (
                  <span className="text-xs text-gray-500 font-normal">
                    Duree totale : {formatDuration(totalDuration)}
                  </span>
                )}
              </h2>
              {timeline.length >= 2 && (
                <button
                  onClick={() => setTimeline((prev) => [...prev].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-purple-400 transition-colors mb-2 cursor-pointer"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Trier par ordre chronologique
                </button>
              )}

              {/* Timeline list */}
              {timeline.length === 0 ? (
                <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center">
                  <svg className="w-10 h-10 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-gray-500 text-sm">Cliquez sur des clips a gauche pour les ajouter a la timeline</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[calc(100vh-420px)] overflow-y-auto pr-1 mb-4">
                  {timeline.map((clip, idx) => (
                    <div
                      key={clip.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={() => handleDrop(idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 p-2 rounded-lg bg-[#18181b] transition-all ${
                        dragOverIdx === idx ? "border-2 border-purple-500" : "border-2 border-transparent"
                      }`}
                    >
                      {/* Drag handle */}
                      <div className="shrink-0 cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                        </svg>
                      </div>

                      {/* Order number */}
                      <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600/50 text-white text-[10px] font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>

                      {/* Thumbnail */}
                      <div className="relative w-[64px] h-[36px] shrink-0 rounded overflow-hidden bg-gray-800">
                        <img src={clip.thumbnail_url} alt={clip.title} className="w-full h-full object-cover" />
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-white truncate">{clip.title}</p>
                        <p className="text-[10px] text-gray-500">
                          {clip.broadcaster_name} · {formatDuration(clip.duration)}
                        </p>
                        <p className="text-[10px] text-gray-600 flex items-center gap-0.5">
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatDate(clip.created_at)}
                        </p>
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => removeFromTimeline(clip.id)}
                        className="shrink-0 p-1 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Generate / Progress / Result */}
              {status === "idle" && (
                <button
                  onClick={handleGenerate}
                  disabled={timeline.length < 2}
                  className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/30 disabled:text-white/40 disabled:cursor-not-allowed text-white rounded-lg py-3 text-sm font-medium transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {timeline.length < 2
                    ? "Selectionnez au moins 2 clips"
                    : `Generer le montage (${timeline.length} clips)`}
                </button>
              )}

              {status === "loading-ffmpeg" && (
                <div className="bg-[#18181b] rounded-lg p-4 text-center">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm text-gray-300">Chargement de FFmpeg...</p>
                  <p className="text-xs text-gray-500 mt-1">Premier chargement ~30MB, mis en cache ensuite</p>
                </div>
              )}

              {status === "downloading" && (
                <div className="bg-[#18181b] rounded-lg p-4">
                  <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
                    <span>Telechargement des clips</span>
                    <span className="text-purple-400">{dlProgress.done}/{dlProgress.total}</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(dlProgress.done / dlProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {status === "concatenating" && (
                <div className="bg-[#18181b] rounded-lg p-4">
                  <div className="flex items-center justify-between text-sm text-gray-300 mb-2">
                    <span>Creation du montage...</span>
                    <span className="text-purple-400">{Math.round(concatProgress * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${concatProgress * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Cela peut prendre quelques minutes...</p>
                </div>
              )}

              {status === "done" && resultUrl && (
                <div className="space-y-2">
                  <div className="bg-green-900/30 border border-green-500/40 rounded-lg p-4 text-center">
                    <svg className="w-8 h-8 text-green-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-sm text-green-300 font-medium">Montage pret !</p>
                  </div>
                  <video
                    src={resultUrl}
                    controls
                    className="w-full rounded-lg bg-black"
                  />
                  <button
                    onClick={handleDownloadResult}
                    className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-3 text-sm font-medium transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Telecharger le montage
                  </button>
                  <button
                    onClick={handleReset}
                    className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                  >
                    Nouveau montage
                  </button>
                </div>
              )}

              {status === "error" && (
                <div className="bg-red-900/30 border border-red-500/40 rounded-lg p-4 text-center">
                  <p className="text-sm text-red-300 mb-2">{errorMessage}</p>
                  <button
                    onClick={handleReset}
                    className="text-xs text-red-400 hover:text-red-300 underline"
                  >
                    Reessayer
                  </button>
                </div>
              )}

              {timeline.length > 0 && status === "idle" && (
                <button
                  onClick={() => setTimeline([])}
                  className="w-full text-center text-xs text-gray-500 hover:text-gray-300 transition-colors py-2 mt-2"
                >
                  Vider la timeline
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
