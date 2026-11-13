/// <reference types="vite/client" />
/*
export interface ImportMetaEnv {
  // Title
  VITE_GLOB_APP_TITLE: string;
  // Port
  VITE_DEV_PORT: string;
  // Dev server address
  VITE_DEV_PATH: string
  // Production address
  VITE_PRO_PATH: string
}


export default ImportMetaEnv
*/

/**
 * Backend service environment type
 * - dev: backend development environment
 * - test: backend test environment
 * - prod: backend production environment
 */
 export type ServiceEnvType = 'dev' | 'test' | 'prod';

 /** Backend service environment config */
 export interface ServiceEnvConfig {
   /** Request URL */
   url: string;
 }
 
 export interface ServiceEnvConfigWithProxyPattern extends ServiceEnvConfig {
   /**
    * Regex string used to match paths
    * - Intercepts and forwards requests via proxy (any string starting with /; a lone / has no effect)
    * - Unrelated to the backend request URL prefix
    * - Use distinct values when there are multiple backend request instances
    */
   proxyPattern: '/proxy-pattern';
 }
 
 export interface ImportMetaEnv {
   // Title
   VITE_GLOB_APP_TITLE: string;
   // Port
   VITE_DEV_PORT: string;
   // Dev server address
   VITE_DEV_PATH: string
   // Production address
   VITE_PRO_PATH: string

   /** Project base URL */
   readonly VITE_BASE_URL: string;
   /** Project name */
   readonly VITE_APP_NAME: string;
   /** Project title */
   readonly VITE_APP_TITLE: string;
   /** Project description */
   readonly VITE_APP_DESC: string;
   /**
    * Permission route mode:
    * - static - static routes declared on the frontend
    * - dynamic - dynamic routes returned by the backend
    */
   readonly VITE_AUTH_ROUTE_MODE: 'static' | 'dynamic';

   /** Prefix for iconify icons used as components */
   readonly VITE_ICON_PREFFIX: string;
   /**
    * Prefix for local SVG icons used as components; must include VITE_ICON_PREFFIX
    * - Format: {VITE_ICON_PREFFIX}-{local icon collection name}
    * - Example: icon-local
    */
   readonly VITE_ICON_LOCAL_PREFFIX: string;
   /** Backend service environment type */
   readonly VITE_SERVICE_ENV?: ServiceEnvType;
   /** Enable request proxy */
   readonly VITE_HTTP_PROXY?: 'Y' | 'N';
   /** Enable bundle size analysis */
   readonly VITE_VISUALIZER?: 'Y' | 'N';
   /** Enable build compression */
   readonly VITE_COMPRESS?: 'Y' | 'N';
   /** Compression algorithm type */
   readonly VITE_COMPRESS_TYPE?: 'gzip' | 'brotliCompress' | 'deflate' | 'deflateRaw';
   /** Enable PWA */
   readonly VITE_PWA?: 'Y' | 'N';
   /**
    * Enable mock in production mode
    * @description In production mode XHR is intercepted and responses cannot be read; set to N when mock requests are not used
    */
   readonly VITE_PROD_MOCK?: 'Y' | 'N';
   /** Hash route mode */
   readonly VITE_HASH_ROUTE?: 'Y' | 'N';
   /** Enable the auto-generated routes plugin */
   readonly VITE_SOYBEAN_ROUTE_PLUGIN?: 'Y' | 'N';
   /** Whether deployed on Vercel */
   readonly VITE_VERCEL?: 'Y' | 'N';
 }

 export  interface ImportMeta {
   readonly env: ImportMetaEnv;
 }
 
 
