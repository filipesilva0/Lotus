// Stand-in for @tauri-apps/plugin-http in the session 5 tests (outside Tauri, http() uses global fetch).
export const fetch = globalThis.fetch;
