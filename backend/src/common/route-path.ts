/**
 * Extracts the matched route *pattern* from a request.
 *
 * Logs and metrics must record `/v1/devices/:id`, never `/v1/devices/cp_dev_01h2…`. The concrete
 * path carries an identifier and produces one metric series per device; the pattern is what is
 * actually aggregatable, and it keeps opaque ids out of log lines.
 *
 * Express types `route` as `any`, so this is the single place that narrows it — rather than four
 * call sites each doing an unchecked member access.
 */
export function routePathOf(request: { route?: unknown; path?: string; url?: string }): string {
  const route = request.route as { path?: unknown } | undefined;
  if (typeof route?.path === 'string') return route.path;
  if (typeof request.path === 'string') return request.path;
  return 'unknown';
}
