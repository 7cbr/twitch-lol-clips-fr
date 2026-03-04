import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;
let fontLoaded = false;

const FONT_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf";

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

  // Single-threaded UMD core — no SharedArrayBuffer / COOP/COEP needed
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

async function ensureFont(ffmpeg: FFmpeg): Promise<void> {
  if (fontLoaded) return;
  try {
    const fontData = await fetchFile(FONT_URL);
    await ffmpeg.writeFile("font.ttf", fontData);
    fontLoaded = true;
  } catch (err) {
    console.warn("Failed to load font, drawtext will be skipped:", err);
  }
}

/**
 * Probe a clip's actual duration by running a quick ffmpeg pass.
 * We use -f null to discard output and parse the duration from logs.
 */
async function probeDuration(ffmpeg: FFmpeg, filename: string): Promise<number> {
  let duration = 0;
  const handler = ({ message }: { message: string }) => {
    // Parse "Duration: HH:MM:SS.ss" from ffmpeg logs
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
  transition?: TransitionOptions
): Promise<Blob> {
  // Write all clips into the virtual filesystem
  for (const input of inputs) {
    await ffmpeg.writeFile(input.filename, input.data);
  }

  // Load font for text overlays
  const hasStreamers = inputs.some((i) => i.streamerName);
  if (hasStreamers) {
    await ensureFont(ffmpeg);
  }

  const useTransition = transition && transition.type !== "none" && inputs.length >= 2;
  const tDur = transition?.duration ?? 0.5;

  // If using transitions, probe actual durations (API durations may be rounded)
  const actualDurations: number[] = [];
  if (useTransition) {
    for (const input of inputs) {
      const probed = await probeDuration(ffmpeg, input.filename);
      // Use probed duration if valid, otherwise fall back to API duration
      actualDurations.push(probed > 0 ? probed : input.duration);
    }
  }

  // Step 1: Scale + pad + normalize + drawtext for each clip
  const filterParts: string[] = [];
  // When using xfade, we need identical fps and pixel format across all clips
  const normalize = useTransition ? ",fps=30,format=yuv420p" : "";

  for (let i = 0; i < inputs.length; i++) {
    const scaleAndPad = `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1${normalize}`;

    if (inputs[i].streamerName && fontLoaded) {
      const name = inputs[i].streamerName!
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\u2019")
        .replace(/:/g, "\\:")
        .replace(/;/g, "\\;");

      filterParts.push(
        `${scaleAndPad},drawtext=fontfile=font.ttf:text='${name}':fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=w-tw-30:y=30[v${i}]`
      );
    } else {
      filterParts.push(`${scaleAndPad}[v${i}]`);
    }
  }

  // Normalize audio when using transitions (same sample rate, channels, format)
  if (useTransition) {
    for (let i = 0; i < inputs.length; i++) {
      filterParts.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a${i}]`
      );
    }
  }

  // Step 2: Video + audio merge
  if (useTransition) {
    // Chain xfade filters between each pair of clips
    let cumulativeDur = actualDurations[0];
    let prevLabel = "v0";

    for (let i = 1; i < inputs.length; i++) {
      // Safety margin: ensure offset doesn't exceed actual clip duration
      const offset = Math.max(0, cumulativeDur - tDur - 0.05);
      const outLabel = i === inputs.length - 1 ? "outv" : `xf${i}`;
      filterParts.push(
        `[${prevLabel}][v${i}]xfade=transition=${transition!.type}:duration=${tDur}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      cumulativeDur = offset + actualDurations[i];
      prevLabel = outLabel;
    }

    // Chain acrossfade for audio (using normalized audio labels)
    let prevAudioLabel = `a0`;
    for (let i = 1; i < inputs.length; i++) {
      const outLabel = i === inputs.length - 1 ? "outa" : `af${i}`;
      filterParts.push(
        `[${prevAudioLabel}][a${i}]acrossfade=d=${tDur}:c1=tri:c2=tri[${outLabel}]`
      );
      prevAudioLabel = outLabel;
    }
  } else {
    // Simple concat (no transitions)
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
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "output.mp4"
  );

  const exitCode = await ffmpeg.exec(args);
  if (exitCode !== 0) {
    // Clean up before throwing
    for (const input of inputs) {
      try { await ffmpeg.deleteFile(input.filename); } catch { /* ignore */ }
    }
    throw new Error(`FFmpeg a echoue (code ${exitCode}). Verifiez la console pour les details.`);
  }

  const data = await ffmpeg.readFile("output.mp4");

  // Clean up virtual filesystem
  for (const input of inputs) {
    await ffmpeg.deleteFile(input.filename);
  }
  await ffmpeg.deleteFile("output.mp4");

  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data as string);

  return new Blob([bytes as BlobPart], { type: "video/mp4" });
}
