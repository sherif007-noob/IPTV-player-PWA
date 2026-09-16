import {
  XtreamCredentials,
  XtreamUserInfo,
  XtreamServerInfo,
  XtreamCategory,
  LiveChannel,
  VodMovie,
  SeriesItem,
  VodDetails,
  SeriesDetails,
  ContentType,
} from '../types';
import {
  MOCK_CATEGORIES,
  MOCK_LIVE_CHANNELS,
  MOCK_MOVIES,
  MOCK_SERIES,
  MOCK_MOVIE_DETAILS,
  MOCK_SERIES_DETAILS,
  SAMPLE_STREAM_URLS,
} from './mockData';

const CREDENTIALS_KEY = 'webos_xtream_credentials';
const CACHE_PREFIX = 'webos_xtream_cache_';

export const DEFAULT_USER_CREDENTIALS: XtreamCredentials = {
  server: 'http://mar10.sbs',
  username: 'Nasser0100',
  password: '01008850042',
  rememberMe: true,
  proxyEnabled: true,
  autoRefreshHours: 12,
};

export class XtreamService {
  private credentials: XtreamCredentials | null = null;
  private userInfo: XtreamUserInfo | null = null;
  private serverInfo: XtreamServerInfo | null = null;
  private isDemoMode: boolean = false;
  private refreshTimer: any = null;
  private onRefreshCallback?: (status: string) => void;

  // In-memory cache to prevent downloading massive 10,000+ title playlists repeatedly
  private categoryCache = new Map<ContentType, XtreamCategory[]>();
  private liveCache = new Map<string, LiveChannel[]>();
  private vodCache = new Map<string, VodMovie[]>();
  private seriesCache = new Map<string, SeriesItem[]>();

  constructor() {
    this.loadSavedCredentials();
  }

  public clearCache() {
    this.categoryCache.clear();
    this.liveCache.clear();
    this.vodCache.clear();
    this.seriesCache.clear();
  }

  public setRefreshListener(callback: (status: string) => void) {
    this.onRefreshCallback = callback;
  }

  public loadSavedCredentials(): XtreamCredentials | null {
    try {
      const saved = localStorage.getItem(CREDENTIALS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Ensure credentials are valid and not default placeholder
        if (
          parsed &&
          parsed.server &&
          !parsed.server.includes('your-provider.com') &&
          parsed.username
        ) {
          const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
          // Ensure active password is used if previously saved with single-digit typo
          const password = parsed.password === '01008550042' ? '01008850042' : (parsed.password || '01008850042');
          this.credentials = {
            ...parsed,
            password,
            proxyEnabled: isFileProtocol ? false : (parsed.proxyEnabled ?? true),
          };
          this.isDemoMode = false;
          this.setupAutoRefresh();
          return this.credentials;
        }
      }
    } catch (e) {
      console.error('Failed to load saved credentials', e);
    }

    // Default to the permanent IPTV server credentials
    this.credentials = { ...DEFAULT_USER_CREDENTIALS };
    this.isDemoMode = false;
    this.setupAutoRefresh();
    try {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(this.credentials));
    } catch {}
    return this.credentials;
  }

  public saveCredentials(creds: XtreamCredentials) {
    // Normalize server URL
    let server = creds.server.trim();
    if (!server.startsWith('http://') && !server.startsWith('https://')) {
      server = 'http://' + server;
    }
    server = server.replace(/\/+$/, '');

    this.credentials = {
      ...creds,
      server,
      lastRefreshed: Date.now(),
    };
    this.isDemoMode = false;
    this.clearCache();
    if (creds.rememberMe) {
      localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(this.credentials));
    } else {
      localStorage.removeItem(CREDENTIALS_KEY);
    }
    this.setupAutoRefresh();
  }

  public clearCredentials() {
    this.credentials = null;
    this.userInfo = null;
    this.serverInfo = null;
    this.isDemoMode = true;
    this.clearCache();
    localStorage.removeItem(CREDENTIALS_KEY);
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  public enableDemoMode() {
    this.isDemoMode = true;
    this.credentials = null;
    this.userInfo = {
      username: 'WebOS_Demo_User',
      status: 'Active',
      exp_date: 'Unlimited (Demo Mode)',
      is_trial: '0',
      active_cons: '1',
      max_connections: '5',
      message: 'Demo streams connected with 4K UHD playback support',
    };
    this.serverInfo = {
      url: 'demo.xtream.local',
      port: '80',
      https_port: '443',
      server_protocol: 'https',
      timezone: 'UTC',
    };
  }

  public getIsDemo(): boolean {
    return this.isDemoMode;
  }

  public getCredentials(): XtreamCredentials | null {
    return this.credentials;
  }

  public getUserInfo(): XtreamUserInfo | null {
    return this.userInfo;
  }

  public getServerInfo(): XtreamServerInfo | null {
    return this.serverInfo;
  }

  private setupAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    if (!this.credentials || this.credentials.autoRefreshHours <= 0) {
      return;
    }

    const intervalMs = this.credentials.autoRefreshHours * 60 * 60 * 1000;
    this.refreshTimer = setInterval(async () => {
      console.log('Automated refresh triggered for Xtream credentials & content');
      try {
        await this.authenticate();
        if (this.onRefreshCallback) {
          this.onRefreshCallback(`Content refreshed automatically at ${new Date().toLocaleTimeString()}`);
        }
      } catch (err) {
        console.warn('Auto refresh failed:', err);
      }
    }, intervalMs);
  }

  private async fetchApi(url: string, useProxy: boolean = true): Promise<any> {
    const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
    const isHttpsBrowser = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    // On packaged TV apps (file:// protocol), local relative /api/ proxy endpoints do NOT exist on the TV.
    // WebOS packaged apps have direct access to external HTTP servers.
    const baseUrl = typeof window !== 'undefined' && !isFileProtocol ? window.location.origin : '';
    
    // Force proxy if we are in an HTTPS browser and the target URL is HTTP (to prevent Mixed Content blocks)
    let shouldProxy = useProxy && !isFileProtocol;
    if (isHttpsBrowser && url.startsWith('http:')) {
      shouldProxy = true;
    }
    
    let primaryUrl = shouldProxy
      ? `${baseUrl}/api/xtream/proxy?url=${encodeURIComponent(url)}`
      : url;
      
    if (shouldProxy && this.credentials) {
      if (this.credentials.userAgent) primaryUrl += `&ua=${encodeURIComponent(this.credentials.userAgent)}`;
      if (this.credentials.referer) primaryUrl += `&referer=${encodeURIComponent(this.credentials.referer)}`;
      if (this.credentials.origin) primaryUrl += `&origin=${encodeURIComponent(this.credentials.origin)}`;
    }

    let response: Response | null = null;
    let lastError: any = null;

    // Retry up to 2 times with backoff if request fails
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 45000) : null;

        response = await fetch(primaryUrl, {
          headers: {
            Accept: 'application/json, text/plain, */*',
          },
          signal: controller?.signal,
        });

        if (timeoutId) clearTimeout(timeoutId);

        if (response && response.ok) {
          break; // Successful response
        } else if (response && response.status >= 500 && attempt < 2) {
          // Server error, wait and retry
          await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
          continue;
        } else if (response) {
          break;
        }
      } catch (err: any) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
          continue;
        }
      }
    }

    // Fallback: only try direct fetch if on HTTP or file:// (never attempt insecure direct HTTP on HTTPS web browsers)
    if (!response && shouldProxy && (!isHttpsBrowser || url.startsWith('https:'))) {
      try {
        console.warn('Proxy attempt failed, attempting direct IPTV server request:', url);
        response = await fetch(url, {
          headers: {
            Accept: 'application/json, text/plain, */*',
          },
        });
      } catch (directErr: any) {
        lastError = directErr;
      }
    }

    if (!response) {
      throw new Error(
        `Network error reaching IPTV server: ${lastError?.message || 'Connection lost'}`
      );
    }

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status} (${response.statusText || 'Error'})`;
      try {
        const errorJson = await response.json();
        if (errorJson && (errorJson.details || errorJson.error)) {
          errorMsg = errorJson.details || errorJson.error;
        }
      } catch {
        // If not JSON, ignore
      }
      throw new Error(`Xtream server error: ${errorMsg}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      const rawText = await response.text();
      const trimmed = rawText.trim();
      if (
        trimmed.startsWith('<!doctype') ||
        trimmed.startsWith('<!DOCTYPE') ||
        trimmed.startsWith('<html') ||
        trimmed.startsWith('<head') ||
        trimmed.startsWith('<body')
      ) {
        throw new Error(
          'Server returned a web page (HTML) instead of the Xtream JSON API response. Please verify the Server URL in settings.'
        );
      }
      try {
        return JSON.parse(rawText);
      } catch {
        throw new Error('Server returned HTML error page instead of playlist data.');
      }
    }

    try {
      return await response.json();
    } catch (parseErr: any) {
      throw new Error(
        `Failed to parse response from server: ${parseErr.message || 'Malformed or truncated JSON'}`
      );
    }
  }

  public async authenticate(creds?: XtreamCredentials): Promise<{ user_info: XtreamUserInfo; server_info: XtreamServerInfo }> {
    const current = creds || this.credentials;
    if (!current) {
      this.enableDemoMode();
      return {
        user_info: this.userInfo!,
        server_info: this.serverInfo!,
      };
    }

    // Validate server URL
    if (!current.server || current.server.includes('your-provider.com')) {
      throw new Error('Please enter a valid Xtream Codes server URL.');
    }
    if (!current.username) {
      throw new Error('Username is required.');
    }

    const apiUrl = `${current.server}/player_api.php?username=${encodeURIComponent(current.username)}&password=${encodeURIComponent(current.password)}`;

    try {
      const data = await this.fetchApi(apiUrl, current.proxyEnabled);
      if (data && data.user_info) {
        // Xtream Codes returns auth: 0 when username/password fails
        if (data.user_info.auth === 0 || data.user_info.status === 'Disabled') {
          throw new Error('Authentication rejected: Invalid username or password, or account disabled.');
        }

        // Parse expiry
        let exp = data.user_info.exp_date;
        if (exp && !isNaN(Number(exp))) {
          const date = new Date(Number(exp) * 1000);
          exp = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        }
        data.user_info.exp_date = exp || 'Active';

        this.userInfo = data.user_info;
        this.serverInfo = data.server_info || {
          url: current.server,
          port: '80',
          https_port: '443',
          server_protocol: current.server.startsWith('https') ? 'https' : 'http',
          timezone: 'UTC',
        };
        this.isDemoMode = false;
        this.saveCredentials(current);
        return {
          user_info: this.userInfo!,
          server_info: this.serverInfo!,
        };
      } else {
        throw new Error('Invalid credentials or unexpected response from Xtream server.');
      }
    } catch (err: any) {
      console.warn('Authentication error:', err.message || err);
      throw new Error(err.message || 'Could not connect to Xtream Codes server');
    }
  }

  public async getCategories(type: ContentType): Promise<XtreamCategory[]> {
    if (this.isDemoMode || !this.credentials) {
      return MOCK_CATEGORIES[type];
    }

    if (this.categoryCache.has(type)) {
      return this.categoryCache.get(type)!;
    }

    const actionMap = {
      live: 'get_live_categories',
      vod: 'get_vod_categories',
      series: 'get_series_categories',
    };

    const url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=${actionMap[type]}`;

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      if (Array.isArray(data)) {
        const result: XtreamCategory[] = [
          { category_id: 'all', category_name: 'All ' + (type === 'live' ? 'Channels' : type === 'vod' ? 'Movies' : 'Series') },
          ...data,
        ];
        this.categoryCache.set(type, result);
        return result;
      }
      return MOCK_CATEGORIES[type];
    } catch (err) {
      console.warn('Falling back to default categories', err);
      return MOCK_CATEGORIES[type];
    }
  }

  public async getLiveStreams(categoryId: string = 'all'): Promise<LiveChannel[]> {
    if (this.isDemoMode || !this.credentials) {
      if (!categoryId || categoryId === 'all') {
        return MOCK_LIVE_CHANNELS;
      }
      return MOCK_LIVE_CHANNELS.filter((c) => c.category_id === categoryId);
    }

    const key = categoryId || 'all';

    // Instant filter if 'all' is already cached
    if (key !== 'all' && this.liveCache.has('all')) {
      const allStreams = this.liveCache.get('all')!;
      return allStreams.filter((c) => c.category_id === key);
    }

    if (this.liveCache.has(key)) {
      return this.liveCache.get(key)!;
    }

    let url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=get_live_streams`;
    if (categoryId && categoryId !== 'all') {
      url += `&category_id=${encodeURIComponent(categoryId)}`;
    }

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      if (Array.isArray(data)) {
        // Strip heavy unneeded API metadata to save ~75% memory on low-RAM TV
        const streams: LiveChannel[] = data.map((item: any) => ({
          stream_id: Number(item.stream_id),
          num: item.num,
          name: String(item.name || ''),
          stream_type: item.stream_type,
          stream_icon: item.stream_icon || '',
          epg_channel_id: item.epg_channel_id,
          category_id: String(item.category_id || ''),
          custom_sid: item.custom_sid,
          direct_source: item.direct_source,
          is4k: /4k|uhd|2160/i.test(item.name || ''),
        }));

        // Limit cache size to prevent TV webview memory leaks
        if (this.liveCache.size > 3 && key !== 'all') {
          const firstKey = this.liveCache.keys().next().value;
          if (firstKey && firstKey !== 'all') this.liveCache.delete(firstKey);
        }

        this.liveCache.set(key, streams);
        return streams;
      }
      return [];
    } catch (err) {
      console.error('Failed to get live streams:', err);
      return MOCK_LIVE_CHANNELS;
    }
  }

  public async getVodStreams(categoryId: string = 'all'): Promise<VodMovie[]> {
    if (this.isDemoMode || !this.credentials) {
      if (!categoryId || categoryId === 'all') {
        return MOCK_MOVIES;
      }
      return MOCK_MOVIES.filter((m) => m.category_id === categoryId);
    }

    const key = categoryId || 'all';

    // Instant filter if 'all' is already cached
    if (key !== 'all' && this.vodCache.has('all')) {
      const allMovies = this.vodCache.get('all')!;
      return allMovies.filter((m) => m.category_id === key);
    }

    if (this.vodCache.has(key)) {
      return this.vodCache.get(key)!;
    }

    let url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=get_vod_streams`;
    if (categoryId && categoryId !== 'all') {
      url += `&category_id=${encodeURIComponent(categoryId)}`;
    }

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      if (Array.isArray(data)) {
        // Strip heavy unneeded API metadata to save ~75% memory on low-RAM TV
        const movies: VodMovie[] = data.map((item: any) => ({
          stream_id: Number(item.stream_id),
          num: item.num,
          name: String(item.name || ''),
          stream_type: item.stream_type,
          stream_icon: item.stream_icon || '',
          rating: item.rating ? String(item.rating) : undefined,
          rating_5based: item.rating_5based,
          category_id: String(item.category_id || ''),
          container_extension: item.container_extension || 'mp4',
          year: item.year ? String(item.year) : undefined,
          is4k: /4k|uhd|2160/i.test(item.name || ''),
        }));

        // Limit cache size
        if (this.vodCache.size > 3 && key !== 'all') {
          const firstKey = this.vodCache.keys().next().value;
          if (firstKey && firstKey !== 'all') this.vodCache.delete(firstKey);
        }

        this.vodCache.set(key, movies);
        return movies;
      }
      return [];
    } catch (err) {
      console.error('Failed to get VOD movies:', err);
      return MOCK_MOVIES;
    }
  }

  public async getSeries(categoryId: string = 'all'): Promise<SeriesItem[]> {
    if (this.isDemoMode || !this.credentials) {
      if (!categoryId || categoryId === 'all') {
        return MOCK_SERIES;
      }
      return MOCK_SERIES.filter((s) => s.category_id === categoryId);
    }

    const key = categoryId || 'all';

    // Instant filter if 'all' is already cached
    if (key !== 'all' && this.seriesCache.has('all')) {
      const allSeries = this.seriesCache.get('all')!;
      return allSeries.filter((s) => s.category_id === key);
    }

    if (this.seriesCache.has(key)) {
      return this.seriesCache.get(key)!;
    }

    let url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=get_series`;
    if (categoryId && categoryId !== 'all') {
      url += `&category_id=${encodeURIComponent(categoryId)}`;
    }

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      if (Array.isArray(data)) {
        // Strip heavy unneeded API metadata to save ~75% memory on low-RAM TV
        const series: SeriesItem[] = data.map((item: any) => ({
          series_id: Number(item.series_id),
          num: item.num,
          name: String(item.name || ''),
          category_id: String(item.category_id || ''),
          cover: item.cover || '',
          rating: item.rating ? String(item.rating) : undefined,
          rating_5based: item.rating_5based,
          releaseDate: item.releaseDate || item.year,
          genre: item.genre,
          plot: item.plot ? String(item.plot).slice(0, 250) : undefined,
          is4k: /4k|uhd|2160/i.test(item.name || ''),
        }));

        // Limit cache size
        if (this.seriesCache.size > 3 && key !== 'all') {
          const firstKey = this.seriesCache.keys().next().value;
          if (firstKey && firstKey !== 'all') this.seriesCache.delete(firstKey);
        }

        this.seriesCache.set(key, series);
        return series;
      }
      return [];
    } catch (err) {
      console.error('Failed to get series:', err);
      return MOCK_SERIES;
    }
  }

  public async getVodDetails(vodId: number): Promise<VodDetails | null> {
    if (this.isDemoMode || !this.credentials) {
      return MOCK_MOVIE_DETAILS[vodId] || null;
    }

    const url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=get_vod_info&vod_id=${vodId}`;

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      return data;
    } catch (err) {
      console.error('Failed to get VOD details:', err);
      return MOCK_MOVIE_DETAILS[vodId] || null;
    }
  }

  public async getSeriesDetails(seriesId: number): Promise<SeriesDetails | null> {
    if (this.isDemoMode || !this.credentials) {
      return MOCK_SERIES_DETAILS[seriesId] || null;
    }

    const url = `${this.credentials.server}/player_api.php?username=${encodeURIComponent(this.credentials.username)}&password=${encodeURIComponent(this.credentials.password)}&action=get_series_info&series_id=${seriesId}`;

    try {
      const data = await this.fetchApi(url, this.credentials.proxyEnabled);
      return data;
    } catch (err) {
      console.error('Failed to get series details:', err);
      return MOCK_SERIES_DETAILS[seriesId] || null;
    }
  }

  // Return direct stream target without proxying (preferred on Smart TVs & native players)
  public getDirectStreamTarget(
    type: 'live' | 'vod' | 'series',
    streamId: string | number,
    extension?: string
  ): string {
    const numericId = Number(streamId);
    if (this.isDemoMode || !this.credentials) {
      return SAMPLE_STREAM_URLS[numericId] || SAMPLE_STREAM_URLS[101];
    }

    const { server, username, password } = this.credentials;
    let cleanServer = server.replace(/\/+$/, '');
    if (!cleanServer.startsWith('http://') && !cleanServer.startsWith('https://')) {
      cleanServer = `http://${cleanServer}`;
    }

    if (type === 'live') {
      return `${cleanServer}/live/${username}/${password}/${streamId}.m3u8`;
    } else if (type === 'vod') {
      const ext = extension || 'mp4';
      return `${cleanServer}/movie/${username}/${password}/${streamId}.${ext}`;
    } else {
      const ext = extension || 'mp4';
      return `${cleanServer}/series/${username}/${password}/${streamId}.${ext}`;
    }
  }

  public getStreamUrl(
    type: 'live' | 'vod' | 'series',
    streamId: string | number,
    extension?: string
  ): string {
    const streamTarget = this.getDirectStreamTarget(type, streamId, extension);
    const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
    const isHttpsBrowser = typeof window !== 'undefined' && window.location.protocol === 'https:';
    
    let shouldProxy = !isFileProtocol && this.credentials?.proxyEnabled !== false;
    if (isHttpsBrowser && streamTarget.startsWith('http:')) {
      shouldProxy = true;
    }

    if (shouldProxy) {
      const baseUrl = typeof window !== 'undefined' && !isFileProtocol ? window.location.origin : '';
      let proxyUrl = `${baseUrl}/api/xtream/stream?url=${encodeURIComponent(streamTarget)}`;
      if (this.credentials) {
        if (this.credentials.userAgent) proxyUrl += `&ua=${encodeURIComponent(this.credentials.userAgent)}`;
        if (this.credentials.referer) proxyUrl += `&referer=${encodeURIComponent(this.credentials.referer)}`;
        if (this.credentials.origin) proxyUrl += `&origin=${encodeURIComponent(this.credentials.origin)}`;
      }
      return proxyUrl;
    }
    return streamTarget;
  }
}

export const xtreamService = new XtreamService();
