export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

/**
 * Compile-time leftover. Agent chrome (top-nav button, canvas status, connect panel)
 * is now shown or hidden by admin 服务管理 (`site.agentEnabled`, default on).
 * Keep the Agent components and stores; do not delete them.
 */
export const LOCAL_AGENT_UI_ENABLED = false;

/**
 * Canvas node-plugin chrome (top-bar manager, bottom-toolbar extensions).
 * Keep plugin loader, host, and nodes; this only hides the current entry points
 * until the plugin product is ready to ship.
 */
export const NODE_PLUGIN_UI_ENABLED = false;

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
