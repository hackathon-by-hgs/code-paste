/**
 * Where users get the desktop agent.
 *
 * The web app mints pairing codes but cannot install anything — the agent is a
 * binary the user runs on their own machine. Without a link to it the flow has
 * a hole in the middle: a code with nothing to type it into.
 */

/** Release carrying the agent binaries for every platform. */
export const AGENT_DOWNLOAD_URL =
  'https://github.com/hackathon-by-hgs/code-paste/releases/tag/desktop-v0.1.0';

/** Shown next to the download link so the platform choice is obvious. */
export const AGENT_PLATFORMS = [
  { label: 'Windows', file: 'agent-windows-amd64.exe' },
  { label: 'macOS (Apple Silicon)', file: 'agent-darwin-arm64' },
  { label: 'macOS (Intel)', file: 'agent-darwin-amd64' },
  { label: 'Linux', file: 'agent-linux-amd64' },
] as const;
