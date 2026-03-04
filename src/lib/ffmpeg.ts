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

export interface ConcatInput {
  filename: string;
  data: Uint8Array;
  streamerName?: string;
}

export async function concatenateClips(
  ffmpeg: FFmpeg,
  inputs: ConcatInput[]
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

  // Build filter_complex: scale each clip to 1920x1080 with padding, add streamer name, then concat
  const filterParts: string[] = [];
  const streamLabels: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const scaleAndPad = `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1`;

    if (inputs[i].streamerName && fontLoaded) {
      // Escape special characters for drawtext
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

    streamLabels.push(`[v${i}][${i}:a]`);
  }

  const filterComplex =
    filterParts.join(";") +
    ";" +
    streamLabels.join("") +
    `concat=n=${inputs.length}:v=1:a=1[outv][outa]`;

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
