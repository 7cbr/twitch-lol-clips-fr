import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

export async function getFFmpeg(
  onProgress?: (ratio: number) => void
): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;

  const ffmpeg = new FFmpeg();

  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => {
      onProgress(Math.max(0, Math.min(1, progress)));
    });
  }

  // Log ffmpeg output for debugging
  ffmpeg.on("log", ({ message }) => {
    console.log("[ffmpeg]", message);
  });

  // NOTE: Multi-threaded core (@ffmpeg/core-mt) is disabled because it deadlocks
  // on complex filter_complex with many inputs (10+ clips). The pthreads-based
  // filter graph execution hangs in the WASM environment.
  // The 720p resolution already provides significant speedup.
  // Re-enable when ffmpeg.wasm fixes this issue.
  const stURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  console.log("[ffmpeg] Loading single-threaded core");
  await ffmpeg.load({
    coreURL: await toBlobURL(`${stURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${stURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  console.log("[ffmpeg] Single-threaded core loaded");

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

/**
 * Probe a clip's actual duration by running a quick ffmpeg pass.
 */
async function probeDuration(ffmpeg: FFmpeg, filename: string): Promise<number> {
  let duration = 0;
  const handler = ({ message }: { message: string }) => {
    const match = message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (match) {
      duration =
        parseInt(match[1]) * 3600 +
        parseInt(match[2]) * 60 +
        parseInt(match[3]) +
        parseInt(match[4]) / 100;
    }
  };
  ffmpeg.on("log", handler);
  await ffmpeg.exec(["-i", filename, "-f", "null", "-"]);
  ffmpeg.off("log", handler);
  return duration;
}

export interface ConcatInput {
  filename: string;
  data: Uint8Array;
  streamerName?: string;
  duration: number; // seconds (from API, used as fallback)
}

export type TransitionType =
  | "none"
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "dissolve"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "smoothleft"
  | "smoothright"
  | "circlecrop"
  | "circleopen"
  | "circleclose"
  | "radial"
  | "pixelize";

export interface TransitionOptions {
  type: TransitionType;
  duration: number; // seconds (e.g. 0.5)
}

export async function concatenateClips(
  ffmpeg: FFmpeg,
  inputs: ConcatInput[],
  transition?: TransitionOptions,
  onFinalize?: () => void
): Promise<Blob> {
  // Write all clips into the virtual filesystem
  for (const input of inputs) {
    await ffmpeg.writeFile(input.filename, input.data);
  }

  const useTransition = transition && transition.type !== "none" && inputs.length >= 2;

  // ─── Re-encode path: filter_complex ───
  // Always re-encode to normalize fps/resolution across clips from different streamers.
  // Concat demuxer (-c copy) can't be used because Twitch clips have varying fps
  // (30/60) which causes playback speed issues when copied without re-encoding.
  console.log(`[ffmpeg] Using filter_complex ${useTransition ? "with xfade transitions" : "with concat"}`);
  const tDur = transition?.duration ?? 0.5;

  // Scale + pad + normalize for compatibility
  const filterParts: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    filterParts.push(
      `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`
    );
  }

  if (useTransition) {
    // Probe actual durations (API durations may be rounded)
    const actualDurations: number[] = [];
    for (const input of inputs) {
      const probed = await probeDuration(ffmpeg, input.filename);
      actualDurations.push(probed > 0 ? probed : input.duration);
    }

    // Normalize audio for acrossfade
    for (let i = 0; i < inputs.length; i++) {
      filterParts.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`
      );
    }

    // Chain xfade filters
    let cumulativeDur = actualDurations[0];
    let prevLabel = "v0";

    for (let i = 1; i < inputs.length; i++) {
      const offset = Math.max(0, cumulativeDur - tDur - 0.05);
      const outLabel = i === inputs.length - 1 ? "outv" : `xf${i}`;
      filterParts.push(
        `[${prevLabel}][v${i}]xfade=transition=${transition!.type}:duration=${tDur}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      cumulativeDur = offset + actualDurations[i];
      prevLabel = outLabel;
    }

    // Chain acrossfade for audio
    let prevAudioLabel = "a0";
    for (let i = 1; i < inputs.length; i++) {
      const outLabel = i === inputs.length - 1 ? "outa" : `af${i}`;
      filterParts.push(
        `[${prevAudioLabel}][a${i}]acrossfade=d=${tDur}:c1=tri:c2=tri[${outLabel}]`
      );
      prevAudioLabel = outLabel;
    }
  } else {
    // Simple concat with re-encode (fallback from concat demuxer)
    const streamLabels = inputs.map((_, i) => `[v${i}][${i}:a]`).join("");
    filterParts.push(
      `${streamLabels}concat=n=${inputs.length}:v=1:a=1[outv][outa]`
    );
  }

  const filterComplex = filterParts.join(";");

  const args: string[] = [];
  for (const input of inputs) {
    args.push("-i", input.filename);
  }
  args.push(
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-map", "[outa]",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "output.mp4"
  );

  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) {
    for (const input of inputs) {
      try { await ffmpeg.deleteFile(input.filename); } catch { /* ignore */ }
    }
    throw new Error(`FFmpeg a echoue (code ${exitCode}). Verifiez la console pour les details.`);
  }

  // Notify caller that encoding is done, now reading the output file
  if (onFinalize) onFinalize();

  const data = await ffmpeg.readFile("output.mp4");

  // Clean up virtual filesystem
  for (const input of inputs) {
    await ffmpeg.deleteFile(input.filename);
  }
  await ffmpeg.deleteFile("output.mp4");

  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);
  return new Blob([bytes as BlobPart], { type: "video/mp4" });
}
