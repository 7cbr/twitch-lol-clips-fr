import { NextResponse } from "next/server";
import { getAllFrenchClips, getFollowerCounts } from "@/lib/twitch";
import { ClipsApiResponse } from "@/types/twitch";

export const maxDuration = 120;

export async function GET() {
  try {
    const clips = await getAllFrenchClips();
    const totalViews = clips.reduce((sum, c) => sum + c.view_count, 0);

    const uniqueIds = [...new Set(clips.map((c) => c.broadcaster_id))];
    const followerCounts = await getFollowerCounts(uniqueIds);

    const response: ClipsApiResponse = {
      clips,
      total: clips.length,
      totalViews,
      followerCounts,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching clips:", error);
    return NextResponse.json(
      { error: "Failed to fetch clips" },
      { status: 500 }
    );
  }
}
