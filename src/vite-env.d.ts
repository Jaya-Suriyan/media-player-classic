/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin, e.g. https://api.example.com. Leave empty when served from the same origin. */
  readonly VITE_API_URL?: string;
}

/** hls.js ships the light build without its own typings; it has the same API. */
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
