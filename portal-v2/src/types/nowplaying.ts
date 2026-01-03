export type Track = {
  id: string;
  videoId?: string;
  title: string;
  artists: string[];
  album?: string;
  imageUrl?: string;
};

export type Play = {
  playId: string;
  playedAt: number;
  track: Track;
  reaction?: Record<string, number>;
};

export type NowplayingRow = {
  id: string;
  video_id: string;
  title: string;
  artists: string;
  album: string | null;
  image_url: string | null;
  duration_sec: number | null;
  played_at: number;
  created_at: number;
  updated_at: number;
};

export type YouTubePlaylistItem = {
  id: string;
  snippet?: {
    resourceId?: { videoId?: string };
    title?: string;
    videoOwnerChannelTitle?: string;
    thumbnails?: { high?: { url?: string } };
    publishedAt?: string;
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
};
