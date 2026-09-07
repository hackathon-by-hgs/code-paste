import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('counts and labels', () => {
    metrics.increment('http_requests_total', { route: '/v1/devices', method: 'GET' });
    metrics.increment('http_requests_total', { route: '/v1/devices', method: 'GET' });
    metrics.increment('http_requests_total', { route: '/v1/devices', method: 'POST' });

    const { counters } = metrics.snapshot();
    expect(counters['http_requests_total{method=GET,route=/v1/devices}']).toBe(2);
    expect(counters['http_requests_total{method=POST,route=/v1/devices}']).toBe(1);
  });

  it('produces a stable key regardless of label order', () => {
    metrics.increment('m', { b: '2', a: '1' });
    metrics.increment('m', { a: '1', b: '2' });
    expect(metrics.snapshot().counters['m{a=1,b=2}']).toBe(2);
  });

  it('summarises durations', () => {
    metrics.observeDuration('d', 10);
    metrics.observeDuration('d', 30);
    expect(metrics.snapshot().durations.d).toEqual({ count: 2, avgMs: 20, maxMs: 30 });
  });

  it('resets', () => {
    metrics.increment('m');
    metrics.observeDuration('d', 5);
    metrics.reset();
    expect(metrics.snapshot()).toEqual({ counters: {}, durations: {} });
  });

  it('records only safe label values', () => {
    // `SPEC_CONTRACT.md` §11.3: route, method, status, error category are safe; clipboard content,
    // payloads and secrets are not — and structurally never reach this service.
    metrics.increment('http_errors_total', { code: 'device_revoked', status: 403 });
    const keys = Object.keys(metrics.snapshot().counters);
    expect(keys[0]).toBe('http_errors_total{code=device_revoked,status=403}');
  });
});
