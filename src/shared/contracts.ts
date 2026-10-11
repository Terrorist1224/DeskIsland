export type WidgetType = 'music' | 'weather' | 'todo';
export type TodoColor = 'yellow' | 'green' | 'blue' | 'orange' | 'pink';
export interface TodoInput { text: string; color: TodoColor; remindAt: number | null }
export interface TodoItem extends TodoInput { id: string; reminderState: 'pending' | 'notified' | 'missed' | null }
export type WidgetVariant = 'square' | 'wide' | 'standard';
export type EditGesture = 'move' | 'nw' | 'ne' | 'sw' | 'se';
export interface WidgetBounds { x:number; y:number; width:number; height:number }

export interface WidgetDefinition {
  typeId: WidgetType;
  title: string;
  defaultSize: { width: number; height: number };
  defaultSettings: Record<string, unknown>;
  variants: { id: WidgetVariant; title: string; size: { width: number; height: number; minimumWidth: number; minimumHeight?: number; maximumWidth?: number; maximumHeight?: number; freeResize?: boolean } }[];
}

export interface WidgetInstance {
  id: string;
  enabled: boolean;
  typeId: WidgetType;
  variantId: WidgetVariant;
  monitorId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId: string | null;
  settings: Record<string, unknown>;
}

export type MediaCommand = 'toggle' | 'next' | 'previous' | 'seek';

export interface MediaSnapshot {
  available: boolean;
  timelineAvailable?: boolean;
  sourceId?: string;
  title?: string;
  artist?: string;
  album?: string;
  thumbnailDataUrl?: string | null;
  playbackStatus?: string;
  positionTicks?: number;
  durationTicks?: number;
  canToggle?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
}

export interface LyricLine {
  timeSeconds: number;
  text: string;
}

export interface LyricsSnapshot {
  source: string;
  trackName: string;
  artistName: string;
  lines: LyricLine[];
  plainLyrics: string | null;
}

export interface WeatherLocation {
  regionCodes?: string[];
  name: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  attribution?: string;
}

export interface WeatherRegion {
  code: string;
  name: string;
  level: number;
}

export interface WeatherSnapshot {
  source?: string;
  location: string;
  temperature: number;
  apparentTemperature: number;
  condition: string;
  weatherCode: number;
  high: number | null;
  low: number | null;
  updatedAt: number;
  stale: boolean;
  attribution: string;
}

export interface DesktopIslandBridge {
  addTodo(input: TodoInput): Promise<TodoItem[]>;
  completeTodo(id: string): Promise<TodoItem[]>;
  moveTodo(id: string, beforeId: string | null): Promise<TodoItem[]>;
  previewTodoReminder(): Promise<void>;
  getAppInfo(): Promise<{ version: string }>;
  getStartupSettings(): Promise<{ supported: boolean; enabled: boolean }>;
  setStartupSettings(enabled: boolean): ReturnType<DesktopIslandBridge['getStartupSettings']>;
  getWeatherCredentialsStatus(): Promise<{ configured: boolean; host: string; mode: 'none' | 'apiKey'; error: string }>;
  saveWeatherCredentials(config: { host: string; apiKey: string }): ReturnType<DesktopIslandBridge['getWeatherCredentialsStatus']>;
  openWeatherLink(kind: 'register' | 'guide' | 'pricing'): Promise<void>;
  configureWeather(): Promise<void>;
  onWeatherConfigurationRequest(callback: (widgetId: string) => void): () => void;
  onWidgetSettingsChange(callback: () => void): () => void;
  onDesktopError(callback: (message:string) => void): () => void;
  beginWidgetGesture(kind: EditGesture): Promise<number>;
  endWidgetGesture(token: number, commit: boolean): Promise<WidgetInstance | null>;
  onWidgetBounds(callback: (bounds: WidgetBounds) => void): () => void;
  onWidgetGestureCancelled(callback: (token: number) => void): () => void;
  listWidgets(): Promise<WidgetInstance[]>;
  createWidget(typeId: WidgetType, variantId: WidgetVariant, enabled?: boolean): Promise<WidgetInstance>;
  getWeatherEnabled(): Promise<boolean>;
  setWeatherEnabled(enabled: boolean): Promise<boolean>;
  setWidgetVariant(id: string, variantId: WidgetVariant): Promise<WidgetInstance>;
  setWidgetEnabled(id: string, enabled: boolean): Promise<WidgetInstance>;
  setEditMode(enabled: boolean): Promise<boolean>;
  getEditMode(): Promise<boolean>;
  onEditModeChange(callback: (enabled: boolean) => void): () => void;
  minimizeControlWindow(): Promise<void>;
  hideControlWindow(): Promise<void>;
  removeWidget(id: string): Promise<void>;
  showWidget(id: string): Promise<boolean>;
  updateWidgetSettings(id: string, patch: Record<string, unknown>): Promise<boolean>;
  getMediaSnapshot(): Promise<MediaSnapshot>;
  getLyrics(track: { title: string; artist: string; album?: string; durationSeconds?: number; sourceId?: string }): Promise<LyricsSnapshot | { error: string } | null>;
  sendMediaCommand(command: MediaCommand, sourceId: string, positionTicks?: number): Promise<{ accepted: boolean; reason?: string }>;
  searchWeatherLocations(query: string): Promise<WeatherLocation[]>;
  listWeatherRegions(parentCode?: string): Promise<WeatherRegion[]>;
  resolveWeatherRegion(code: string): Promise<WeatherLocation>;
  saveWeatherLocation(widgetId: string, regionCode: string): Promise<WeatherLocation>;
  getWeather(location: WeatherLocation): Promise<WeatherSnapshot>;
  onWidgetActiveChange(callback: (active: boolean) => void): () => void;
}

declare global {
  interface Window {
    deskIsland: DesktopIslandBridge;
    todoReminder: {
      getItems(): Promise<TodoItem[]>;
      dismiss(): Promise<void>;
      onItems(callback: (items: TodoItem[]) => void): () => void;
    };
  }
}
