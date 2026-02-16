"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import JSZip from "jszip";
import { TwitchClip, ClipsApiResponse } from "@/types/twitch";
import StreamerFilter from "@/components/StreamerFilter";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDayLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00");
  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest > 0 ? `${m}m${rest.toString().padStart(2, "0")}s` : `${m}m`;
}

function getParentDomain(): string {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname;
}

function clipFilename(clip: TwitchClip): string {
  const d = new Date(clip.created_at);
  const date = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", "h");
  const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, "-");
  return `${safe(clip.title)} - ${safe(clip.creator_name)} - ${safe(date)} ${time}.mp4`;
}

type SortMode = "views" | "date";

export default function Home() {
  const [clips, setClips] = useState<TwitchClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TwitchClip | null>(null);
  const [total, setTotal] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [sort, setSort] = useState<SortMode>("views");
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterStreamers, setFilterStreamers] = useState<string[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/clips");
        const data: ClipsApiResponse = await res.json();
        setClips(data.clips);
        setTotal(data.total);
        setTotalViews(data.totalViews);
        if (data.clips.length > 0) setSelected(data.clips[0]);
      } catch (err) {
        console.error("Failed to fetch clips:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const streamerNames = useMemo(() => {
    const names = [...new Set(clips.map((c) => c.broadcaster_name))];
    names.sort((a, b) => a.localeCompare(b, "fr"));
    return names;
  }, [clips]);

  const availableDates = useMemo(() => {
    const dates = [
      ...new Set(clips.map((c) => new Date(c.created_at).toISOString().slice(0, 10))),
    ];
    dates.sort((a, b) => b.localeCompare(a));
    return dates;
  }, [clips]);

  const filteredAndSorted = useMemo(() => {
    let filtered = clips;
    if (filterDate) {
      filtered = filtered.filter(
        (c) => new Date(c.created_at).toISOString().slice(0, 10) === filterDate
      );
    }
    if (filterStreamers.length > 0) {
      const set = new Set(filterStreamers);
      filtered = filtered.filter((c) => set.has(c.broadcaster_name));
    }
    const sorted = [...filtered];
    if (sort === "date") {
      sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else {
      sorted.sort((a, b) => b.view_count - a.view_count);
    }
    return sorted;
  }, [clips, sort, filterDate, filterStreamers]);

  // Reset checked when filters change
  useEffect(() => {
    setCheckedIds(new Set());
  }, [filterDate, filterStreamers]);

  const parentDomain = getParentDomain();
  const embedUrl = selected
    ? `https://clips.twitch.tv/embed?clip=${selected.id}&parent=${parentDomain}&autoplay=true`
    : "";

  function toggleCheck(clipId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clipId)) next.delete(clipId);
      else next.add(clipId);
      return next;
    });
  }

  function toggleAll() {
    if (checkedIds.size === filteredAndSorted.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filteredAndSorted.map((c) => c.id)));
    }
  }

  // Clips to download: checked ones if any, otherwise all filtered
  const clipsToDownload = useMemo(() => {
    if (checkedIds.size > 0) {
      return filteredAndSorted.filter((c) => checkedIds.has(c.id));
    }
    return filteredAndSorted;
  }, [filteredAndSorted, checkedIds]);

  const handleDownloadSelection = useCallback(async () => {
    if (downloadingAll || clipsToDownload.length === 0) return;
    setDownloadingAll(true);
    setDownloadProgress({ done: 0, total: clipsToDownload.length });

    const zip = new JSZip();
    let done = 0;

    for (let i = 0; i < clipsToDownload.length; i += 3) {
      const batch = clipsToDownload.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map(async (clip) => {
          const url = `/api/download?url=${encodeURIComponent(clip.thumbnail_url)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`Failed: ${clip.title}`);
          return { clip, blob: await res.blob() };
        })
      );

      for (const result of results) {
        done++;
        setDownloadProgress({ done, total: clipsToDownload.length });
        if (result.status === "fulfilled") {
          zip.file(clipFilename(result.value.clip), result.value.blob);
        }
      }
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clips-lol-fr-${clipsToDownload.length}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadingAll(false);
  }, [downloadingAll, clipsToDownload]);

  function handleDownload(clip: TwitchClip) {
    const filename = clipFilename(clip);
    const url = `/api/download?url=${encodeURIComponent(clip.thumbnail_url)}&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

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

  const downloadLabel = checkedIds.size > 0
    ? `Telecharger la selection (${checkedIds.size} clips)`
    : `Telecharger tout (${filteredAndSorted.length} clips)`;

  /* Shared clip row renderer */
  function renderClipRow(clip: TwitchClip, isMobile: boolean) {
    const isPlaying = selected?.id === clip.id;
    const isChecked = checkedIds.has(clip.id);
    const thumbW = isMobile ? "w-[100px] h-[56px]" : "w-[120px] h-[68px]";

    return (
      <div
        key={clip.id}
        className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
          isPlaying
            ? "bg-purple-900/30 border border-purple-500/40"
            : "hover:bg-[#18181b]"
        }`}
      >
        {/* Checkbox */}
        <button
          onClick={() => toggleCheck(clip.id)}
          className="shrink-0"
        >
          <div
            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              isChecked
                ? "bg-purple-600 border-purple-600"
                : "border-gray-600 hover:border-gray-400"
            }`}
          >
            {isChecked && (
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            )}
          </div>
        </button>

        {/* Clickable clip content */}
        <button
          onClick={() => {
            setSelected(clip);
            if (typeof window !== "undefined" && window.gtag) {
              window.gtag("event", "clip_click", {
                streamer_id: clip.broadcaster_id,
                streamer_name: clip.broadcaster_name,
                clip_id: clip.id,
                clip_name: clip.title,
                clip_date: clip.created_at,
                clip_duration: clip.duration,
              });
            }
            if (isMobile) window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="flex gap-3 flex-1 min-w-0 text-left"
        >
          <div className={`relative ${thumbW} shrink-0 rounded overflow-hidden bg-gray-800`}>
            <img src={clip.thumbnail_url} alt={clip.title} className="w-full h-full object-cover" />
            {isPlaying && (
              <div className="absolute top-1 left-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
            <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1 rounded flex items-center gap-0.5">
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              </svg>
              {clip.view_count}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white line-clamp-2 leading-tight">
              {clip.title}
            </p>
            <p className="text-xs text-gray-400 mt-1">{clip.broadcaster_name}</p>
            <p className="text-xs text-gray-500">
              {clip.creator_name} · {formatDate(clip.created_at)} · <span className="text-gray-400">{formatDuration(clip.duration)}</span>
            </p>
          </div>
        </button>
      </div>
    );
  }

  /* Shared download button */
  function renderDownloadButton() {
    return (
      <button
        onClick={handleDownloadSelection}
        disabled={downloadingAll || filteredAndSorted.length === 0}
        className="w-full flex items-center justify-center gap-2 mb-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white rounded-lg py-2 text-xs font-medium transition-colors cursor-pointer"
      >
        {downloadingAll ? (
          <>
            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Telechargement {downloadProgress.done}/{downloadProgress.total}
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {downloadLabel}
          </>
        )}
      </button>
    );
  }

  /* Shared header row (sort + select all + count) */
  function renderListHeader() {
    return (
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAll}
            className="text-[11px] text-gray-400 hover:text-white transition-colors"
          >
            {checkedIds.size === filteredAndSorted.length && filteredAndSorted.length > 0
              ? "Tout decocher"
              : "Tout cocher"}
          </button>
          <div className="flex bg-[#18181b] rounded-lg p-0.5">
            <button
              onClick={() => setSort("views")}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                sort === "views" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Plus vues
            </button>
            <button
              onClick={() => setSort("date")}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                sort === "date" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Recents
            </button>
          </div>
        </div>
        <span className="text-xs text-gray-500">
          {checkedIds.size > 0 && <span className="text-purple-400">{checkedIds.size} / </span>}
          {filteredAndSorted.length} clips
        </span>
      </div>
    );
  }

  /* Shared filters */
  function renderFilters() {
    return (
      <div className="mb-3 space-y-2">
        <StreamerFilter
          allStreamers={streamerNames}
          selected={filterStreamers}
          onChange={setFilterStreamers}
        />
        <select
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="w-full bg-[#18181b] text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none"
        >
          <option value="">Toutes les dates</option>
          {availableDates.map((d) => (
            <option key={d} value={d}>{formatDayLabel(d)}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      {/* Header */}
      <header className="px-6 pt-5 pb-4">
        <div className="max-w-[1600px] mx-auto flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">League of Legends</h1>
            <p className="text-sm text-gray-400 mt-1">
              {total} clips · {totalViews.toLocaleString("fr-FR")} vues au total
            </p>
          </div>
          <span className="text-sm border border-gray-600 text-gray-300 rounded px-3 py-1">
            Francais
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="px-6 pb-6">
        <div className="max-w-[1600px] mx-auto flex gap-5">
          {/* Left: Player */}
          <div className="flex-1 min-w-0">
            {selected && (
              <>
                <div className="aspect-video bg-black rounded-lg overflow-hidden">
                  <iframe key={selected.id} src={embedUrl} allowFullScreen className="w-full h-full" />
                </div>
                <div className="mt-3">
                  <h2 className="text-lg font-semibold">{selected.title}</h2>
                  <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" /></svg>
                      {selected.broadcaster_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-2.207 2.207L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                      {selected.creator_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                      {selected.view_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
                      {formatFullDate(selected.created_at)}
                    </span>
                    <span className="text-gray-500">{formatDuration(selected.duration)}</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 bg-[#18181b] hover:bg-[#252528] border border-gray-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                  >
                    <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                    </svg>
                    Voir sur Twitch
                  </a>
                  <button
                    onClick={() => handleDownload(selected)}
                    className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Telecharger
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Right: Clip list (desktop) */}
          <div className="w-[420px] shrink-0 hidden lg:block">
            {renderListHeader()}
            {renderFilters()}
            {renderDownloadButton()}
            <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
              {filteredAndSorted.map((clip) => renderClipRow(clip, false))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile clip list */}
      <div className="lg:hidden px-6 pb-6">
        {renderListHeader()}
        {renderFilters()}
        {renderDownloadButton()}
        <div className="space-y-1">
          {filteredAndSorted.map((clip) => renderClipRow(clip, true))}
        </div>
      </div>
    </div>
  );
}
