export type PlaybackKind = 'hls' | 'file';

export interface PlaybackSource {
  url: string;
  kind: PlaybackKind;
  // When the URL stops working (ISO date); null when it is not signed.
  expiresAt: string | null;
}
