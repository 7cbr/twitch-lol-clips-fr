export interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  broadcaster_name: string;
  creator_id: string;
  creator_name: string;
  video_id: string;
  game_id: string;
  language: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
}

export interface TwitchPaginatedResponse<T> {
  data: T[];
  pagination: {
    cursor?: string;
  };
}

export interface ClipsApiResponse {
  clips: TwitchClip[];
  total: number;
  totalViews: number;
}
