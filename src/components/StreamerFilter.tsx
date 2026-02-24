"use client";

import { useState, useRef, useEffect, useMemo } from "react";

export interface StreamerGroup {
  name: string;
  streamers: string[];
}

const GROUPS_KEY = "twitch-lol-clips-fr-groups";

function loadGroups(): StreamerGroup[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveGroups(groups: StreamerGroup[]) {
  localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
}

interface StreamerFilterProps {
  allStreamers: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  followerCounts?: Record<string, number>;
  clipCounts?: Record<string, number>;
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${n}`;
}

export default function StreamerFilter({
  allStreamers,
  selected,
  onChange,
  followerCounts,
  clipCounts,
}: StreamerFilterProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<StreamerGroup[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGroups(loadGroups());
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const suggestions = useMemo(() => {
    let list: string[];
    if (!query.trim()) {
      list = allStreamers.filter((s) => !selected.includes(s));
    } else {
      const q = query.toLowerCase();
      list = allStreamers.filter(
        (s) => s.toLowerCase().includes(q) && !selected.includes(s)
      );
    }
    if (followerCounts) {
      list.sort((a, b) => (followerCounts[b] ?? 0) - (followerCounts[a] ?? 0));
    }
    return list;
  }, [allStreamers, query, selected, followerCounts]);

  function addStreamer(name: string) {
    onChange([...selected, name]);
    setQuery("");
  }

  function removeStreamer(name: string) {
    onChange(selected.filter((s) => s !== name));
  }

  function loadGroup(group: StreamerGroup) {
    // Merge group streamers with current selection, only keeping valid ones
    const valid = new Set(allStreamers);
    const merged = new Set([
      ...selected,
      ...group.streamers.filter((s) => valid.has(s)),
    ]);
    onChange([...merged]);
  }

  function handleSaveGroup() {
    if (!newGroupName.trim() || selected.length === 0) return;
    const updated = [
      ...groups.filter((g) => g.name !== newGroupName.trim()),
      { name: newGroupName.trim(), streamers: [...selected] },
    ];
    setGroups(updated);
    saveGroups(updated);
    setNewGroupName("");
    setShowGroupModal(false);
  }

  function deleteGroup(name: string) {
    const updated = groups.filter((g) => g.name !== name);
    setGroups(updated);
    saveGroups(updated);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Groups bar */}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {groups.map((g) => (
            <span
              key={g.name}
              className="inline-flex items-center gap-1 text-[11px] rounded-full"
            >
              <button
                onClick={() => loadGroup(g)}
                className="bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 pl-2 pr-1 py-0.5 rounded-l-full transition-colors"
              >
                {g.name} ({g.streamers.length})
              </button>
              <button
                onClick={() => deleteGroup(g.name)}
                className="bg-blue-600/20 text-blue-400 hover:text-red-400 pr-1.5 py-0.5 rounded-r-full transition-colors"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 bg-purple-600/30 text-purple-300 text-[11px] pl-2 pr-1 py-0.5 rounded-full"
            >
              {name}
              <button
                onClick={() => removeStreamer(name)}
                className="hover:text-white rounded-full p-0.5"
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </span>
          ))}
          <button
            onClick={() => onChange([])}
            className="text-[11px] text-gray-500 hover:text-gray-300 px-1"
          >
            Effacer
          </button>
          <button
            onClick={() => setShowGroupModal(true)}
            className="text-[11px] text-purple-400 hover:text-purple-300 px-1"
            title="Sauvegarder comme groupe"
          >
            Sauvegarder
          </button>
        </div>
      )}

      {/* Save group modal */}
      {showGroupModal && (
        <div className="flex gap-1.5 mb-1.5">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveGroup()}
            placeholder="Nom du groupe..."
            className="flex-1 bg-[#18181b] text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-blue-500 focus:outline-none placeholder-gray-500"
            autoFocus
          />
          <button
            onClick={handleSaveGroup}
            disabled={!newGroupName.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            OK
          </button>
          <button
            onClick={() => {
              setShowGroupModal(false);
              setNewGroupName("");
            }}
            className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1.5"
          >
            Annuler
          </button>
        </div>
      )}

      {/* Input */}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Filtrer par streamer..."
        className="w-full bg-[#18181b] text-gray-300 text-xs rounded-lg px-2.5 py-1.5 border border-gray-700 focus:border-purple-500 focus:outline-none placeholder-gray-500"
      />

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-[#1f1f23] border border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {suggestions.map((name) => (
            <button
              key={name}
              onClick={() => addStreamer(name)}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20 hover:text-white transition-colors"
            >
              <span>{name}</span>
              <span className="flex items-center gap-2 ml-2">
                {clipCounts?.[name] != null && (
                  <span className="text-gray-500 flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                    </svg>
                    {clipCounts[name]}
                  </span>
                )}
                {followerCounts?.[name] != null && (
                  <span className="text-purple-400 flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 17v1h-3zM4.75 14.094A5.973 5.973 0 004 17v1H1v-1a3 3 0 013.75-2.906z" />
                    </svg>
                    {formatFollowers(followerCounts[name])}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
