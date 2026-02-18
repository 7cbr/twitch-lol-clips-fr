import { NextRequest, NextResponse } from "next/server";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface GqlClipResponse {
  data: {
    clip: {
      playbackAccessToken: {
        signature: string;
        value: string;
      };
      videoQualities: {
        quality: string;
        sourceURL: string;
      }[];
    } | null;
  };
}

/**
 * Extract the clip slug from a thumbnail URL.
 * New format: https://static-cdn.jtvnw.net/twitch-clips-thumbnails-prod/{slug}/{uuid}/preview-480x272.jpg
 * Old format: https://clips-media-assets2.twitch.tv/{slug}-preview-480x272.jpg
 */
function extractSlug(thumbnailUrl: string): string | null {
  // New CDN format
  const newMatch = thumbnailUrl.match(
    /twitch-clips-thumbnails-prod\/([^/]+)\//
  );
  if (newMatch) return newMatch[1];

  // Old CDN format
  const oldMatch = thumbnailUrl.match(
    /clips-media-assets2\.twitch\.tv\/([^/]+?)-preview-/
  );
  if (oldMatch) return oldMatch[1];

  return null;
}

async function getClipVideoUrl(slug: string): Promise<string | null> {
  const res = await fetch(TWITCH_GQL_URL, {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      {
        operationName: "VideoAccessToken_Clip",
        variables: { slug },
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash:
              "36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11",
          },
        },
      },
    ]),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as GqlClipResponse[];
  const clip = json[0]?.data?.clip;
  if (!clip || !clip.videoQualities?.length) return null;

  // Pick best quality (first is highest)
  const sourceURL = clip.videoQualities[0].sourceURL;
  const sig = clip.playbackAccessToken.signature;
  const token = clip.playbackAccessToken.value;

  return `${sourceURL}?sig=${encodeURIComponent(sig)}&token=${encodeURIComponent(token)}`;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  const filename = request.nextUrl.searchParams.get("filename") || "clip.mp4";
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const slug = extractSlug(url);
  if (!slug) {
    return NextResponse.json(
      { error: "Could not extract clip slug from URL" },
      { status: 400 }
    );
  }

  try {
    const videoUrl = await getClipVideoUrl(slug);
    if (!videoUrl) {
      return NextResponse.json(
        { error: "Could not get video URL from Twitch" },
        { status: 502 }
      );
    }

    const res = await fetch(videoUrl);
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
