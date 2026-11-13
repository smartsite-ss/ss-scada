// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import { IProtocolAdapter } from './types';

/**
 * Plugin development server - provides an isolated debugging environment
 *
 * Supports:
 *  - Manual connect/disconnect of devices
 *  - Single read/write of tags
 *  - Continuous-collection stress testing
 *  - Connection-status query
 *
 * Usage:
 *   const devServer = new PluginDevServer(new MyService(), 5101);
 *   devServer.start();
 *   // visit http://localhost:5101/debug
 */
export class PluginDevServer {
  private app: any;
  private service: IProtocolAdapter;
  private activeClients = new Map<string, any>();
  private port: number;

  constructor(service: IProtocolAdapter, port: number = 5101) {
    this.service = service;
    this.port = port;
  }

  /** Start the development server */
  async start(): Promise<void> {
    const express = await this.loadExpress();
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
    this.app.listen(this.port, () => {
      console.log(`[DevServer] Plugin dev server started -> http://localhost:${this.port}`);
      console.log(
        `[DevServer] Debug endpoints: POST /debug/connect | /debug/read | /debug/write | /debug/disconnect`,
      );
      console.log(`[DevServer] Stress test: POST /debug/stress-test`);
    });
  }

  /** Stop the server */
  stop(): void {
    this.activeClients.clear();
  }

  private setupRoutes(): void {
    const app = this.app;

    // Connect device
    app.post('/debug/connect', async (req: any, res: any) => {
      try {
        const client = await this.service.connect(req.body);
        const deviceId = req.body.id || req.body.deviceId || 'debug-device';
        this.activeClients.set(deviceId, client);
        res.json({ status: 'connected', deviceId });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Read tag
    app.post('/debug/read', async (req: any, res: any) => {
      try {
        const { deviceId, tagConfig } = req.body;
        const client = this.activeClients.get(deviceId);
        if (!client) {
          return res.status(400).json({ error: 'Device not connected' });
        }
        const result = await this.service.readTag(client, tagConfig);
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Write tag
    app.post('/debug/write', async (req: any, res: any) => {
      try {
        const { deviceId, tagConfig, value } = req.body;
        const client = this.activeClients.get(deviceId);
        if (!client) {
          return res.status(400).json({ error: 'Device not connected' });
        }
        await this.service.writeTag(client, tagConfig, value);
        res.json({ status: 'written' });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Stress test
    app.post('/debug/stress-test', async (req: any, res: any) => {
      try {
        const { deviceId, tagConfigs, duration, interval } = req.body;
        const client = this.activeClients.get(deviceId);
        if (!client) {
          return res.status(400).json({ error: 'Device not connected' });
        }

        const results: any[] = [];
        const startTime = Date.now();
        const endTime = startTime + (duration || 10000);
        let errorCount = 0;

        const run = async () => {
          while (Date.now() < endTime) {
            for (const tc of tagConfigs) {
              try {
                const t0 = Date.now();
                const result = await this.service.readTag(client, tc);
                results.push({
                  tagId: tc.tagId || tc.id,
                  value: result.value,
                  elapsed: Date.now() - t0,
                  quality: (result as any).quality || 'good',
                });
              } catch (e) {
                errorCount++;
                results.push({
                  tagId: tc.tagId || tc.id,
                  error: String(e),
                  elapsed: 0,
                });
              }
            }
            await new Promise((r) => setTimeout(r, interval || 100));
          }
        };

        await run();
        const totalElapsed = Date.now() - startTime;
        const successCount = results.length - errorCount;

        res.json({
          totalRequests: results.length,
          successCount,
          errorCount,
          duration: totalElapsed,
          avgLatency:
            results.length > 0
              ? results.reduce((s: number, r: any) => s + r.elapsed, 0) / results.length
              : 0,
          throughput: results.length / (totalElapsed / 1000),
          results: results.slice(0, 100), // return only the first 100 entries
        });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Disconnect
    app.post('/debug/disconnect', async (req: any, res: any) => {
      try {
        const { deviceId } = req.body;
        const client = this.activeClients.get(deviceId);
        if (client) {
          await this.service.disconnect(client);
          this.activeClients.delete(deviceId);
        }
        res.json({ status: 'disconnected' });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    // Status query
    app.get('/debug/status', (_req: any, res: any) => {
      res.json({
        activeConnections: this.activeClients.size,
        deviceIds: Array.from(this.activeClients.keys()),
      });
    });
  }

  private async loadExpress(): Promise<any> {
    try {
      return require('express');
    } catch {
      throw new Error(
        'express is required for PluginDevServer. Install it: pnpm add express @types/express',
      );
    }
  }
}
