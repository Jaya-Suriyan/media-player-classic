import { createStore } from "./hooks";

/** Liked songs & listening history, kept on this device. */
export const likedStore = createStore<string[]>("mpc.liked", []);
export const historyStore = createStore<string[]>("mpc.history", []);

export function toggleLike(id: string) {
  likedStore.set((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, 2000)));
}

export function useIsLiked(id: string | undefined) {
  const ids = likedStore.use();
  return !!id && ids.includes(id);
}

export function pushHistory(id: string) {
  historyStore.set((ids) => [id, ...ids.filter((x) => x !== id)].slice(0, 100));
}

export type Quality = "auto" | "saver" | "high";

export interface Settings {
  /** auto = adapt to network, saver = always 48 kbps, high = 160 kbps */
  quality: Quality;
  volume: number;
  muted: boolean;
}

export const settingsStore = createStore<Settings>("mpc.settings", { quality: "auto", volume: 0.9, muted: false });

/** Default to data-saver on slow / metered connections. */
export function suggestedQuality(): Quality | null {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (!c) return null;
  if (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g") return "saver";
  return null;
}
