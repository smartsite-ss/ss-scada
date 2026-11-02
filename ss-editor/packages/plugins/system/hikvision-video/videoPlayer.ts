// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Pure functions for video channel and playback protocol adaptation.
 * Playback cores (jessibuca / flv.js / hls.js) are browser-side decoding libraries loaded on demand;
 * this module only carries protocol mapping and grid layout pure logic for easy unit testing.
 */

export type VideoProtocol = 'webrtc' | 'http-flv' | 'hls';

export type VideoLayout = '1x1' | '2x2' | '3x3';

export interface VideoChannel {
  /** Channel unique ID (used for Vue key / deletion / sorting) */
  id: string;
  /** Channel name (e.g. Camera 1, East Gate entrance) */
  name: string;
  /** RTSP source address (rtsp://user:pass@host:554/..., for records / gateway configuration) */
  sourceUrl: string;
  /** Playback address after gateway stream conversion (consumed by the frontend) */
  playUrl: string;
  /** Playback protocol */
  protocol: VideoProtocol;
  /** Camera authentication username (optional) */
  username: string;
  /** Camera authentication password (optional) */
  password: string;
  /** Whether enabled (disabled shows a placeholder) */
  enabled: boolean;
}

/**
 * Select the playback core type based on the protocol.
 * - hls → native <video> (natively supported by Safari; other browsers need hls.js)
 * - http-flv → requires flv.js
 * - webrtc → requires jessibuca / WebRTC signaling
 */
export function resolvePlayerKind(protocol: VideoProtocol): 'native' | 'flv' | 'webrtc' {
  switch (protocol) {
    case 'hls':
      return 'native';
    case 'http-flv':
      return 'flv';
    case 'webrtc':
      return 'webrtc';
  }
}

/** Validate whether a channel is playable: enabled and a playback address is configured */
export function isPlayableChannel(channel: VideoChannel): boolean {
  return channel.enabled && Boolean(channel.playUrl);
}

/** Return the grid rows/columns and total slot count for a layout */
export function resolveGrid(layout: VideoLayout): { columns: number; rows: number; total: number } {
  const map: Record<VideoLayout, { columns: number; rows: number; total: number }> = {
    '1x1': { columns: 1, rows: 1, total: 1 },
    '2x2': { columns: 2, rows: 2, total: 4 },
    '3x3': { columns: 3, rows: 3, total: 9 },
  };
  return map[layout];
}

/** Crop the channel list to the visible slot count for a layout (extras ignored, missing slots as placeholders) */
export function resolveVisibleChannels(channels: VideoChannel[], layout: VideoLayout): VideoChannel[] {
  const { total } = resolveGrid(layout);
  return channels.slice(0, total);
}
