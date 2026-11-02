// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

/**
 * Unified notification channel interface
 */
export interface INotificationChannel {
  /** Channel name */
  readonly name: string;
  /** Send notification */
  send(targets: string[], payload: NotificationPayload): Promise<boolean>;
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  /** Title */
  title: string;
  /** Message content */
  message: string;
  /** Alarm severity */
  level: string;
  /** Device name */
  deviceName?: string;
  /** Timestamp */
  timestamp: Date;
}
