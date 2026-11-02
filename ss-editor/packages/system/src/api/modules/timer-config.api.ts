// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import client from '../client';

/** Timer configuration entry */
export interface TimerConfigEntry {
  id: string;
  name: string;
  module: string;
  currentInterval: number;
  defaultInterval: number;
  description: string;
  runtimeUpdate: boolean;
}

export const timerConfigApi = {
  /** Get all scheduled task configurations */
  getAll(): Promise<TimerConfigEntry[]> {
    return client.get('/system/timer-configs').then((res) => res.data);
  },

  /** Get a single scheduled task configuration */
  getById(id: string): Promise<TimerConfigEntry> {
    return client.get(`/system/timer-configs/${id}`).then((res) => res.data);
  },

  /** Update a scheduled task interval */
  updateInterval(id: string, interval: number): Promise<TimerConfigEntry> {
    return client
      .put(`/system/timer-configs/${id}`, { interval })
      .then((res) => res.data);
  },

  /** Reset a scheduled task to its default value */
  resetInterval(id: string): Promise<TimerConfigEntry> {
    return client
      .post(`/system/timer-configs/${id}/reset`)
      .then((res) => res.data);
  },
};
