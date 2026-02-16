import { NextResponse } from "next/server";
import { getAllFrenchClips } from "@/lib/twitch";
import { ClipsApiResponse } from "@/types/twitch";

export const maxDuration = 30;

export async function GET() {
  try {
    const clips = await getAllFrenchClips();
    const totalViews = clips.reduce((sum, c) => sum + c.view_count, 0);

    const response: ClipsApiResponse = {
      clips,
      total: clips.length,
      totalViews,
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
