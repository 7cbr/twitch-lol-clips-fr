"use client";

import { useState, useRef, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { TwitchClip } from "@/types/twitch";

interface AssembleProgress {
  phase: "download" | "assemble" | "done";
  current: number;
  total: number;
}

const BATCH_SIZE = 3;
const CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

export function useVideoAssembler() {
  const [assembling, setAssembling] = useState(false);
  const [assembleProgress, setAssembleProgress] = useState<AssembleProgress | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  const getFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;

    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      console.log("[ffmpeg]", message);
    });
    await ffmpeg.load({
      coreURL: CORE_URL,
      wasmURL: WASM_URL,
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }, []);

  const assemble = useCallback(async (clips: TwitchClip[]) => {
    if (clips.length === 0 || assembling) return;

    setAssembling(true);
    setAssembleProgress({ phase: "download", current: 0, total: clips.length });

    const filenames: string[] = [];
    const tsFiles: string[] = [];

    try {
      const ffmpeg = await getFFmpeg();

      // Phase 1: Download clips in batches
      for (let i = 0; i < clips.length; i += BATCH_SIZE) {
        const batch = clips.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (clip, batchIdx) => {
            const idx = i + batchIdx;
            const filename = `input_${idx}.mp4`;
            const downloadUrl = `/api/download?url=${encodeURIComponent(clip.thumbnail_url)}`;
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`Echec du telechargement: ${clip.title}`);
            const data = await response.arrayBuffer();
            return { filename, data };
          })
        );

        for (const { filename, data } of results) {
          await ffmpeg.writeFile(filename, new Uint8Array(data));
          filenames.push(filename);
        }

        setAssembleProgress({
          phase: "download",
          current: Math.min(i + BATCH_SIZE, clips.length),
          total: clips.length,
        });
      }

      // Phase 2: Remux MP4 → TS, concat, remux → MP4 (no re-encoding)
      setAssembleProgress({ phase: "assemble", current: 0, total: 1 });

      for (let i = 0; i < filenames.length; i++) {
        const tsName = `seg_${i}.ts`;
        await ffmpeg.exec([
          "-i", filenames[i],
          "-c", "copy",
          "-bsf:v", "h264_mp4toannexb",
          "-f", "mpegts",
          "-y", tsName,
        ]);
        tsFiles.push(tsName);
      }

      const filelistContent = tsFiles.map((f) => `file '${f}'`).join("\n");
      await ffmpeg.writeFile("filelist.txt", filelistContent);

      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "filelist.txt",
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        "-movflags", "+faststart",
        "output.mp4",
      ]);

      // Phase 3: Read result and trigger download
      const outputData = (await ffmpeg.readFile("output.mp4")) as Uint8Array;
      const blob = new Blob([new Uint8Array(outputData)], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `clips_assembles_${new Date().toISOString().slice(0, 10)}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setAssembleProgress({ phase: "done", current: 1, total: 1 });

      // Cleanup
      for (const f of [...filenames, ...tsFiles]) {
        await ffmpeg.deleteFile(f).catch(() => {});
      }
      await ffmpeg.deleteFile("filelist.txt").catch(() => {});
      await ffmpeg.deleteFile("output.mp4").catch(() => {});
    } catch (err) {
      console.error("Erreur assemblage video:", err);
      const ffmpeg = ffmpegRef.current;
      if (ffmpeg) {
        for (const f of [...filenames, ...tsFiles]) {
          await ffmpeg.deleteFile(f).catch(() => {});
        }
      }
      throw err;
    } finally {
      setAssembling(false);
      setTimeout(() => setAssembleProgress(null), 2000);
    }
  }, [assembling, getFFmpeg]);

  return { assemble, assembling, assembleProgress };
}
