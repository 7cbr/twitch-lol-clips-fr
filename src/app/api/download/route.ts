import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const filename = request.nextUrl.searchParams.get("filename") || "clip.mp4";
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  // Derive MP4 URL from thumbnail URL.
  // Twitch moved thumbnails to static-cdn.jtvnw.net but MP4s still live on
  // clips-media-assets2.twitch.tv. Extract the clip slug and build the MP4 URL.
  let mp4Url: string;
  const jtvnwMatch = url.match(
    /static-cdn\.jtvnw\.net\/twitch-clips\/(.+?)-preview-\d+x\d+\.\w+/
  );
  if (jtvnwMatch) {
    mp4Url = `https://clips-media-assets2.twitch.tv/${jtvnwMatch[1]}.mp4`;
  } else {
    // Legacy format: clips-media-assets2.twitch.tv/...-preview-480x272.jpg
    mp4Url = url.replace(/-preview-\d+x\d+\.\w+(\?.*)?$/, ".mp4");
  }

  try {
    const res = await fetch(mp4Url);
    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch clip video" },
        { status: 502 }
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", "video/mp4");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/"/g, "'")}"`
    );
    const contentLength = res.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(res.body, { status: 200, headers });
  } catch {
    return NextResponse.json(
      { error: "Download failed" },
      { status: 500 }
    );
  }
}
