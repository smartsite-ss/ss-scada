// Copyright (c) 2025 Smart Site Team
// https://smartsite.top/
// Contact: zkxxa@qq.com, zcwebms@gmail.com

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, getProductMode } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as express from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { json, urlencoded, Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import compression from 'compression';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { acquireInstanceLock } from './utils/single-instance-guard';
import {
  TransformInterceptor,
  getLogConfig,
  createAppFileTransport,
  createErrorFileTransport,
} from '@ss-node/ss-core';

// ============================================================
//  Startup timing utilities
//  Record the duration of each startup phase and print to console for diagnostics
// ============================================================

const STARTUP_TAG = 'Startup';

/** Helper: format milliseconds into a human-readable string */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/** Phase timer: record the start time and return a stop function (prints elapsed time when called) */
function startPhase(name: string): () => void {
  const t0 = performance.now();
  // Use console.log instead of Logger because Logger is only available after NestFactory.create
  console.log(`[${STARTUP_TAG}] ⏳ ${name} ...`);
  return () => {
    const elapsed = performance.now() - t0;
    console.log(`[${STARTUP_TAG}] ✅ ${name} done (${formatMs(elapsed)})`);
  };
}

/**
 * S-C01: enforce JWT_SECRET validation at startup
 *
 * Rules:
 *   1. Must be set (non-empty)
 *   2. At least 32 characters long (to resist brute-force)
 *   3. In production must not be a repository default key (allowed in dev but warns)
 *
 * If validation fails, refuse to start and print a clear error message.
 */
function validateJwtSecret(): void {
  const secret = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  // CODE-09: known default/placeholder keys in the repo (including placeholders in .env.base and .env)
  // Also smart_scada_secret_key_change_this_in_production (original .env placeholder; length 47 passes the length check but is still a placeholder)
  const KNOWN_DEFAULT_SECRETS = [
    'your-secret-key',
    'your-super-secret-jwt-key-change-this-in-production',
    'changeme',
    'secret',
    'jwt-secret',
    'my-secret',
    'super-secret',
    'smart_scada_secret_key_change_this_in_production',
    'smart_scada_secret_key',
    'ss-node-secret-key-change-this-in-production',
  ];
  // CODE-09: placeholder signature substrings - keys containing these words are treated as placeholders (forbidden in production)
  // Only flag when length is also < 64 (avoids false positives on legitimate long random strings containing "secret")
  const PLACEHOLDER_PATTERNS = [
    'change-this',
    'change_this',
    'changeme',
    'your-',
    'replace-',
    'placeholder',
    'default-secret',
    'todo-replace',
  ];

  if (!secret) {
    console.error('[FATAL] JWT_SECRET is not set. Configure a random secret of at least 32 characters in .env.');
    process.exit(1);
  }

  if (secret.length < 32) {
    console.error(
      `FATAL: JWT_SECRET is too short (current ${secret.length} chars, at least 32 required). ` +
        'Generate a secure secret with `openssl rand -base64 48`.',
    );
    process.exit(1);
  }

  const isDefaultSecret = KNOWN_DEFAULT_SECRETS.includes(secret);
  // CODE-09: heuristic placeholder detection (only for keys shorter than 64 chars, to reduce false positives)
  const hasPlaceholderPattern =
    secret.length < 64 && PLACEHOLDER_PATTERNS.some((p) => secret.toLowerCase().includes(p));
  const isWeakSecret = isDefaultSecret || hasPlaceholderPattern;

  if (isProduction && isWeakSecret) {
    console.error(
      'FATAL: Production forbids the repository default or a placeholder JWT_SECRET. ' +
        'Configure a randomly generated secret in .env (openssl rand -base64 48). ' +
        'Detected: ' +
        (isDefaultSecret ? 'known default value; ' : 'contains placeholder keywords; '),
    );
    process.exit(1);
  }

  if (isWeakSecret) {
    console.warn(
      '[Startup] ⚠️ JWT_SECRET uses the repository default or a placeholder, development only. ' +
        'Replace it with a randomly generated secret for production deployment.',
    );
  } else {
    console.log('[Startup] ✅ JWT_SECRET validation passed');
  }
}

async function bootstrap() {
  const totalStart = performance.now();

  // ──────── Phase -1: secure startup validation ────────
  // S-C01: JWT_SECRET strength check; reject weak keys at startup
  validateJwtSecret();
  // ──────── Phase 0: environment preparation ────────
  const endPhase0 = startPhase('Phase 0: 环境准备（日志目录/项目根解析）');

  // Resolve project root: consistent with initProjectRoot() in app.module.ts
  // - dev mode:  __dirname up 3 levels = ss-services/ss-node (this file is in apps/ss-node-server/src/ or dist/)
  // - prod mode: process.cwd() = ss-run/ss/services/ss-node
  const projectRoot =
    process.env.NODE_ENV === 'production'
      ? process.cwd()
      : path.resolve(__dirname, '..', '..', '..');

  // Set SS_NODE_ROOT early for use by services under packages such as PathResolverService.
  // Must be set before NestFactory.create so the log path read by LogViewerService
  // matches the path written here (otherwise differing process.cwd() causes write/read path mismatch).
  if (!process.env.SS_NODE_ROOT) {
    process.env.SS_NODE_ROOT = projectRoot;
  }

  // Two backends sharing one DATA_DIR corrupt the SQLite files (duplicated
  // sqlite_master entries -> "malformed database schema"). Claim the directory before
  // NestFactory.create so a second instance fails fast with a clear message.
  acquireInstanceLock(process.env.DATA_DIR || 'data', projectRoot);

  // Resolve unified logging config: LOG_DIR / LOG_MAX_SIZE / LOG_MAX_FILES / LOG_LEVEL
  // getLogConfig resolves LOG_DIR relative path based on SS_NODE_ROOT, consistent with PathResolverService
  const logConfig = getLogConfig();
  if (!fs.existsSync(logConfig.logDir)) {
    fs.mkdirSync(logConfig.logDir, { recursive: true });
  }
  endPhase0();

  // ──────── Phase 1: NestFactory.create (module load + DI container init + onModuleInit) ────────
  const endPhase1 = startPhase('Phase 1: NestFactory.create（模块加载/DI/onModuleInit）');

  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      transports: [
        // P1 optimization: disable the Console transport in production, keep only the file transport
        // Eliminates the log stalling caused by Winston's Console (internal synchronous process.stdout.write)
        ...(process.env.NODE_ENV !== 'production'
          ? [
              new winston.transports.Console({
                // Controlled by the LOG_LEVEL env var (default 'info')
                // Set LOG_LEVEL=warn to see only warn+error, or LOG_LEVEL=error to see only error while debugging
                level: process.env.LOG_LEVEL || 'info',
                format: winston.format.combine(
                  winston.format.timestamp(),
                  winston.format.ms(),
                  winston.format((info) => {
                    if (info.context === 'RouterExplorer' || info.context === 'RoutesResolver') {
                      return false;
                    }
                    return info;
                  })(),
                  winston.format.colorize(),
                  winston.format.printf(({ timestamp, level, message, context, ms }) => {
                    return `${timestamp} [${level}] [${context || 'Nest'}] ${message} ${ms}`;
                  }),
                ),
              }),
            ]
          : []),
        // Error-log transport: error/error-%DATE%.log (daily + size rotation, gzip-compressed)
        createErrorFileTransport(logConfig),
        // Application-log transport: app/app-%DATE%.log (daily + size rotation, gzip-compressed)
        createAppFileTransport(logConfig),
      ],
    }),
  });
  endPhase1();

  // ──────── Phase 1.5: database migration (authoritative entry for schema changes) ────────
  // CODE-08: in production synchronize=false; schema changes rely entirely on migrations;
  // In dev, synchronize auto-alters tables, but migrations must still run to complete the version record.
  // runMigrations applies incrementally based on the migrations table and is naturally idempotent; each migration also
  // has column/index existence guards, supporting legacy databases built by synchronize that never ran migrations.
  const endPhase15 = startPhase('Phase 1.5: 数据库 migration');
  try {
    const dataSource = app.get(DataSource);
    const executed = await dataSource.runMigrations();
    if (executed.length > 0) {
      console.log(
        `[${STARTUP_TAG}] ✅ Executed ${executed.length} migrations: ${executed
          .map((m) => m.name)
          .join(', ')}`,
      );
    } else {
      console.log(`[${STARTUP_TAG}] ✅ Database migrations are up to date`);
    }
  } catch (err) {
    console.error(
      `[${STARTUP_TAG}] ❌ Database migration failed: ${err instanceof Error ? err.message : err}`,
    );
    // Do not abort startup: dev falls back to synchronize; in production investigate then retry
  }
  endPhase15();

  // ──────── Phase 2: middleware and pipe configuration ────────
  const endPhase2 = startPhase('Phase 2: 中间件/管道/拦截器/安全配置');

  // ── global exception filter ──
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── response-format normalization interceptor ──
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── global validation pipe ──
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── gzip compression (only compress responses > 1KB) ──
  app.use(
    compression({
      threshold: 1024,
      level: 6,
    }),
  );

  // ── S-H01: Helmet security headers (CSP / X-Content-Type-Options / X-Frame-Options, etc.) ──
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Vue dev mode needs inline scripts; can be tightened after production build
          // WeChat QR-code login needs to load the QR JS SDK from open.weixin.qq.com
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'https://open.weixin.qq.com',
            'https://res.wx.qq.com',
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          // WeChat avatar CDN (thirdwx.qlogo.cn) must be allowed to load images
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.qlogo.cn', 'https://wx.qlogo.cn'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          // WeChat QR code is embedded as an iframe (open.weixin.qq.com/connect/qrconnect)
          frameSrc: ["'self'", 'https://open.weixin.qq.com'],
          // The WeChat SDK may load worker/frame sub-resources from its CDN
          childSrc: ["'self'", 'https://open.weixin.qq.com'],
        },
      },
      // Allow resource loading under CORS
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ── cookie-parser (S-C03 Token relies on HttpOnly Cookie) ──
  app.use(cookieParser());

  // ── hide X-Powered-By (Helmet already covers it; kept here as a fallback) ──
  app.getHttpAdapter().getInstance().disable('x-powered-by');

  // ── Cache-Control caching policy ──
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/docs')) {
      res.setHeader('Cache-Control', 'public, max-age=300');
    } else if (req.path === '/api/v1/system/health') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-cache');
    }
    next();
  });

  // ── CORS ──
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // X-Request-Id is the correlation header injected by the frontend request interceptor; its absence breaks the desktop (Tauri, cross-origin)
    // CORS preflight, and all requests are blocked by the browser with no error (login page appears unresponsive when clicked)
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
    credentials: true,
    maxAge: 86400,
  });

  // ── S-H05: tiered request-body size limits (prevent oversized-body DoS) ──
  // Set different limits per route:
  //   - /api/v1/projects: 50mb (project import / page save need a large body)
  //   - /api/v1/devices/import: 10mb (batch device import)
  //   - default (incl. AI chat): 2mb
  app.use('/api/v1/projects', json({ limit: '50mb' }));
  app.use('/api/v1/projects', urlencoded({ limit: '50mb', extended: true }));
  app.use('/api/v1/devices', json({ limit: '10mb' }));
  app.use('/api/v1/devices', urlencoded({ limit: '10mb', extended: true }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ limit: '2mb', extended: true }));

  // ── API version prefix ──
  app.setGlobalPrefix('api/v1');
  endPhase2();

  // ──────── Phase 3: Swagger docs ────────
  const endPhase3 = startPhase('Phase 3: Swagger 文档生成');

  // S-M04: Swagger docs environment isolation
  // - dev:  normally expose /api/docs
  // - prod: only expose when SWAGGER_USER + SWAGGER_PASSWORD are set (protected by HTTP Basic Auth)
  //            if unset, disable entirely to prevent API structure leakage
  const isProductionEnv = process.env.NODE_ENV === 'production';
  const swaggerUser = process.env.SWAGGER_USER;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  const enableSwagger = !isProductionEnv || (!!swaggerUser && !!swaggerPassword);

  const productMode = getProductMode();

  if (enableSwagger) {
    const swaggerTitleMap: Record<string, string> = {
      full: 'Smart SCADA Platform API',
      scada: 'ss-scada API',
      data: 'ss-data API',
    };
    const swaggerDescMap: Record<string, string> = {
      full: 'Smart SCADA Platform - 集成模式（ss-scada + ss-data 全部能力）',
      scada: 'ss-scada - 组态编辑器/运行器（仅共享 + scada 模块）',
      data: 'ss-data - 数据中台/系统管理（仅共享 + data 模块）',
    };
    const config = new DocumentBuilder()
      .setTitle(swaggerTitleMap[productMode] || 'Smart SCADA API')
      .setDescription(`${swaggerDescMap[productMode] || ''}\n\nProduct Mode: ${productMode}`)
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'JWT-auth')
      .addTag('auth', '认证授权')
      .addTag('projects', '项目管理')
      .addTag('devices', '设备管理')
      .addTag('tags', '数据标签')
      .addTag('alarms', '报警管理')
      .addTag('data', '数据查询')
      .addTag('system', '系统管理')
      .addTag('scripts', '脚本引擎')
      .addTag('realtime', '实时通信')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // prod: protect /api/docs and its JSON endpoint with HTTP Basic Auth
    if (isProductionEnv && swaggerUser && swaggerPassword) {
      const swaggerAuthRealm = 'Smart SCADA API Docs';
      app.use(
        ['/api/docs', '/api/docs-json', '/api/docs-yaml'],
        (req: Request, res: Response, next: NextFunction) => {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.setHeader('WWW-Authenticate', `Basic realm="${swaggerAuthRealm}"`);
            res.status(401).send('Authentication required');
            return;
          }
          const encoded = authHeader.slice('Basic '.length);
          let decoded: string;
          try {
            decoded = Buffer.from(encoded, 'base64').toString('utf-8');
          } catch {
            res.setHeader('WWW-Authenticate', `Basic realm="${swaggerAuthRealm}"`);
            res.status(401).send('Invalid credentials');
            return;
          }
          const separatorIndex = decoded.indexOf(':');
          const user = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : '';
          const pass = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';
          // Use constant-time comparison to prevent timing attacks
          if (
            user.length !== swaggerUser.length ||
            pass.length !== swaggerPassword.length ||
            !crypto.timingSafeEqual(Buffer.from(user), Buffer.from(swaggerUser)) ||
            !crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(swaggerPassword))
          ) {
            res.setHeader('WWW-Authenticate', `Basic realm="${swaggerAuthRealm}"`);
            res.status(401).send('Invalid credentials');
            return;
          }
          next();
        },
      );
      Logger.log('🔒 Swagger API Docs protected by HTTP Basic Auth', 'Swagger');
    }

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        tryItOutEnabled: true,
      },
    });
    endPhase3();
  } else {
    console.warn(
      '[Startup] ⚠️ SWAGGER_USER/SWAGGER_PASSWORD not configured in production; API docs disabled.\n' +
        '  To enable, set SWAGGER_USER and SWAGGER_PASSWORD in .env.pro.',
    );
    endPhase3();
  }

  // ──────── S1 single-process: backend serves the frontend SPA (optional, single-package release; see the single-package release doc) ────────
  // Enabled when WEB_DIST_DIR is explicitly set and index.html exists in that dir; otherwise behavior is unchanged (frontend served by Nginx).
  //
  // ⚠️ Why not use `app.use()` / `app.get()`:
  //   1) Nest registers a "throw NotFoundException on no match" handler during init() (inside NestFactory.create), so any
  //      404 handler added after create() never receives unmatched requests;
  //   2) `app.get(...)` on the Nest app object is a **DI lookup** (container.get); passing a route param throws and
  //      is caught by ExceptionsZone -> process.exit(1) (appears as "silent exit after Phase 3").
  //   So instead we insert frontend hosting at the **front** of the HTTP server's request listener chain:
  //   hit static file -> return directly; miss -> fall back to index.html; everything else (API/WS/non-GET) -> hand back to Nest.
  //   Note: this must run before app.listen() -- Socket.IO attaches inside listen(),
  //   and will wrap this handler, naturally ensuring /socket.io is still handled first by engine.io.
  const webDistDir = path.resolve(projectRoot, process.env.WEB_DIST_DIR || 'web');
  const webIndexHtml = path.join(webDistDir, 'index.html');
  if (process.env.WEB_DIST_DIR && fs.existsSync(webIndexHtml)) {
    const httpServerForSpa = app.getHttpServer();
    const nestRequestHandler = httpServerForSpa.listeners('request')[0] as
      ((req: unknown, res: unknown) => void) | undefined;
    if (typeof nestRequestHandler !== 'function') {
      Logger.warn(
        `WEB_DIST_DIR is set but the HTTP request handler is unavailable; skipping SPA hosting (frontend must be served by Nginx)`,
        'Bootstrap',
      );
    } else {
      const compress = compression();
      // redirect:false -- otherwise serve-static issues a 301 on same-named dirs (and enters the
      // unavailable res.redirect branch); here we leave it to SPA fallback.
      const serveStatic = express.static(webDistDir, {
        index: false,
        maxAge: '7d',
        redirect: false,
      });
      // ⚠️ the res here is a **bare http.ServerResponse** (not express-wrapped):
      //    it has no res.sendFile / res.redirect methods => output the pre-read index.html directly.
      const indexHtml = fs.readFileSync(webIndexHtml);
      const serveIndexHtml = (req: IncomingMessage, res: ServerResponse): void => {
        try {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': String(indexHtml.length),
            'Cache-Control': 'no-cache',
          });
          res.end(req.method === 'HEAD' ? undefined : indexHtml);
        } catch {
          nestRequestHandler(req, res);
        }
      };
      /** API / WebSocket / docs prefixes: always hand back to Nest, so SPA fallback won't swallow them */
      const NEST_OWNED_PREFIX = /^\/(?:api\/|socket\.io\/?|docs\/?)/;
      /**
       * Asset-like requests must answer 404 on miss -- never fall back to index.html.
       *
       * Why: a missing /plugins/<cat>/<type>/<ver>/index.mjs used to return index.html with
       * HTTP 200, so the browser's dynamic import() reported "Unexpected token '<'" (or a
       * generic module load failure) instead of a clean 404, hiding packaging defects
       * (plugin manifest declaring artifacts that were never built) behind cryptic errors.
       */
      const ASSET_PREFIX = /^\/(?:assets|plugins|static|downloads)\//;
      const ASSET_FILE_EXT =
        /\.(?:m?js|css|map|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|wasm|txt|xml|html?)$/i;
      const serveNotFound = (res: ServerResponse): void => {
        const body = Buffer.from('Not Found');
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': String(body.length),
          'Cache-Control': 'no-store',
        });
        res.end(body);
      };
      httpServerForSpa.removeAllListeners('request');
      httpServerForSpa.on('request', (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || '/';
        const pathname = url.split('?')[0];
        const isStaticCandidate =
          (req.method === 'GET' || req.method === 'HEAD') && !NEST_OWNED_PREFIX.test(url);
        if (!isStaticCandidate) return nestRequestHandler(req, res);
        const isAssetRequest = ASSET_PREFIX.test(pathname) || ASSET_FILE_EXT.test(pathname);
        // gzip is provided by compression (equivalent to Nginx gzip); index.html fallback only for SPA routes
        compress(req as unknown as Request, res as unknown as Response, () =>
          serveStatic(req as unknown as Request, res as unknown as Response, () => {
            if (res.writableEnded) return;
            if (res.headersSent) return void res.end();
            if (isAssetRequest) return serveNotFound(res);
            serveIndexHtml(req, res);
          }),
        );
      });
      Logger.log(`🖥️  SPA hosting enabled (single-process, no Nginx): ${webDistDir}`, 'Bootstrap');
    }
  }

  // ──────── Phase 4: HTTP listen start ────────
  const endPhase4 = startPhase('Phase 4: HTTP 服务监听（app.listen）');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  endPhase4();

  // ──────── Phase 5: HTTP keep-alive tuning ────────
  // CODE-06: SQLite PRAGMA（journal_mode/synchronous/cache_size/temp_store）
  // Moved to extra.pragma in getDatabaseConfig() of app.module.ts, applying to all connections in the pool
  // (the original ds.query('PRAGMA ...') only affected a single connection, so the cache_size optimization had no real effect).
  const endPhase5 = startPhase('Phase 5: HTTP keep-alive 调优');

  // ── Extend Keep-Alive timeout to 65s (slightly above Nginx's default 60s) ──
  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout = 65000;
  httpServer.headersTimeout = 66000;
  endPhase5();

  const totalElapsed = performance.now() - totalStart;

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Smart SCADA Server running on: http://localhost:${port}`);
  logger.log(`📚 API Docs: http://localhost:${port}/api/docs`);
  logger.log(`💚 Health Check: http://localhost:${port}/api/v1/system/health`);
  logger.log(`⚙️ Product Mode: ${productMode}`);
  logger.log(`⏱️ Total startup time: ${formatMs(totalElapsed)}`);

  // ASCII Art banner -- use console.log so it is visible in all modes (not controlled by Winston's Console transport)
  // Read the 3D ASCII art from the slogo/logo.txt logo file (under the docs directory)
  const logoPath = path.resolve(__dirname, 'assets/logo.txt');
  try {
    const logo = fs.readFileSync(logoPath, 'utf-8');
    console.log('');
    console.log(logo);
  } catch {
    // Fall back to a simple banner when the file does not exist
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║          Smart Site  v7              ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
  }
}

bootstrap().catch((error: unknown) => {
  // Startup failures (port in use, data dir owned by another instance, invalid
  // configuration) must terminate the process: without this the event loop stayed
  // alive with timers/schedulers, producing a "zombie" instance that logs but never
  // serves HTTP.
  const message = error instanceof Error ? error.message : String(error);
  console.error('\n[FATAL] Service startup failed:\n' + message + '\n');
  process.exit(1);
});
