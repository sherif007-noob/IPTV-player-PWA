export type ContentType = 'live' | 'vod' | 'series';

export type TvFontSize = 'small' | 'medium' | 'large' | 'huge' | 'maximum';

export type MainNavView = 
  | 'home'
  | 'live' 
  | 'vod' 
  | 'series' 
  | 'favorites' 
  | 'watchlist' 
  | 'continue_watching' 
  | 'settings';

export interface XtreamCredentials {
  server: string;
  username: string;
  password: string;
  proxyEnabled: boolean;
  autoRefreshHours: number;
  lastRefreshed?: number;
  rememberMe: boolean;
  userAgent?: string;
  referer?: string;
  origin?: string;
}

export interface XtreamUserInfo {
  username: string;
  status: string;
  exp_date: string;
  is_trial: string;
  active_cons: string;
  max_connections: string;
  created_at?: string;
  message?: string;
  auth?: number;
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  https_port: string;
  server_protocol: string;
  rtmp_port?: string;
  timezone: string;
  timestamp_now?: number;
  time_now?: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id?: number | string;
}

export interface LiveChannel {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number;
  stream_icon?: string;
  epg_channel_id?: string;
  added?: string;
  category_id: string;
  custom_sid?: string;
  tv_archive?: number;
  direct_source?: string;
  is4k?: boolean;
}

export interface VodMovie {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  added?: string;
  category_id: string;
  container_extension?: string;
  is4k?: boolean;
  year?: string;
}

export interface VodDetails {
  info: {
    name?: string;
    movie_image?: string;
    tmdb_id?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    duration_secs?: number;
    duration?: string;
    rating?: string | number;
    backdrop_path?: string[];
    youtube_trailer?: string;
    video?: {
      width?: number;
      height?: number;
      codec?: string;
    };
    audio?: {
      codec?: string;
      channels?: number;
    };
    bitrate?: number;
  };
  movie_data: {
    stream_id: number;
    name?: string;
    container_extension?: string;
  };
}

export interface SeriesItem {
  num?: number;
  name: string;
  series_id: number;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string | number;
  rating_5based?: number;
  category_id: string;
  backdrop_path?: string[];
  youtube_trailer?: string;
  episode_run_time?: string | number;
  is4k?: boolean;
}

export interface Episode {
  id: string | number;
  episode_num: number;
  title: string;
  container_extension?: string;
  season: number;
  info: {
    duration_secs?: number;
    duration?: string;
    plot?: string;
    movie_image?: string;
    rating?: string | number;
    release_date?: string;
    bitrate?: number;
    video?: {
      width?: number;
      height?: number;
    };
  };
}

export interface SeriesDetails {
  info: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string | number;
    backdrop_path?: string[];
    youtube_trailer?: string;
    episode_run_time?: string;
  };
  episodes: Record<string, Episode[]>;
  seasons: {
    season_number: number;
    name?: string;
    episode_count?: number;
    air_date?: string;
  }[];
}

export interface PlaybackProgress {
  id: string | number;
  type: ContentType;
  title: string;
  subtitle?: string;
  poster?: string;
  backdrop?: string;
  timestamp: number;
  duration: number;
  streamUrl: string;
  seriesId?: number;
  seasonNum?: number;
  episodeId?: string | number;
  episodeNum?: number;
  lastUpdated: number;
}

export interface WatchedEpisodeRecord {
  seriesId: number;
  seasonNum: number;
  episodeNum: number;
  watched: boolean;
  completedAt?: number;
}

export interface ContentItem {
  id: string | number;
  type: ContentType;
  name: string;
  category_id: string;
  icon?: string;
  rating?: string | number;
  year?: string;
  container_extension?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  is4k?: boolean;
  seriesId?: number;
}

export interface StreamQualityLevel {
  index: number;
  height: number;
  width: number;
  bitrate: number;
  label: string;
}

// LG webOS Remote Key Codes
export const WEBOS_KEYS = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 461, // LG webOS specific back key
  ESCAPE: 27, // Standard browser back / esc
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  FAST_FORWARD: 417,
  REWIND: 412,
  INFO: 457,
} as const;
