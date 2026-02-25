import { NextRequest, NextResponse } from "next/server";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
// Public client-id used by the Twitch web player
const TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

interface ClipAccessToken {
  signature: string;
  value: string;
}

interface ClipVideoQuality {
  quality: string;
  sourceURL: string;
}

interface GqlResponse {
  data: {
    clip: {
      playbackAccessToken: ClipAccessToken;
      videoQualities: ClipVideoQuality[];
    } | null;
  };
}

async function getClipVideoUrl(
  slug: string
): Promise<{ url: string; sig: string; token: string } | null> {
  const res = await fetch(TWITCH_GQL_URL, {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_GQL_CLIENT_ID,
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

  const json: GqlResponse[] = await res.json();
  const clip = json[0]?.data?.clip;
  if (!clip?.videoQualities?.length) return null;

  // Pick the best quality (first entry is highest)
  const best = clip.videoQualities[0];
  return {
    url: best.sourceURL,
    sig: clip.playbackAccessToken.signature,
    token: clip.playbackAccessToken.value,
  };
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  const filename = request.nextUrl.searchParams.get("filename") || "clip.mp4";
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const video = await getClipVideoUrl(slug);
  if (!video) {
    return NextResponse.json(
      { error: "Could not resolve clip video URL" },
      { status: 404 }
    );
  }

  const mp4Url = `${video.url}?sig=${video.sig}&token=${encodeURIComponent(video.token)}`;

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
