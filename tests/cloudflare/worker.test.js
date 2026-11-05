import { describe, it, expect, vi } from 'vitest';
import worker from '../../cloudflare/worker.js';

function bindings() {
  const fetch = vi.fn(async () => new Response('{"status":"ok"}', {
    headers: { 'content-type': 'application/json' },
  }));
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('asset')) },
    CLIPPY_COORDINATOR: {
      idFromName: vi.fn((name) => name),
      get: vi.fn(() => ({ fetch })),
    },
    fetch,
  };
}

describe('Cloudflare Worker entrypoint', () => {
  it('routes WebSocket upgrades to the pairing-code shard without wrapping the response', async () => {
    const env = bindings();
    const response = { status: 101, webSocket: {} };
    env.fetch.mockResolvedValue(response);
    const request = new Request('https://clippy.test/ws?code=abc-12d', {
      headers: { Upgrade: 'websocket' },
    });
    expect(await worker.fetch(request, env)).toBe(response);
    expect(env.CLIPPY_COORDINATOR.idFromName).toHaveBeenCalledWith('ABC-12D');
    expect(env.fetch).toHaveBeenCalledWith(request);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('rejects HTTP requests to /ws before accessing the Durable Object', async () => {
    const env = bindings();
    expect((await worker.fetch(new Request('https://clippy.test/ws'), env)).status).toBe(426);
    expect(env.CLIPPY_COORDINATOR.get).not.toHaveBeenCalled();
  });

  it('probes the requested shard and preserves the health response', async () => {
    const env = bindings();
    const result = await worker.fetch(new Request('https://clippy.test/health?code=ABC-12D'), env);
    expect(await result.json()).toEqual({ status: 'ok' });
    expect(env.CLIPPY_COORDINATOR.idFromName).toHaveBeenCalledWith('ABC-12D');
    expect(new URL(env.fetch.mock.calls[0][0].url).searchParams.get('code')).toBe('ABC-12D');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('uses the existing lobby name for health without a valid code', async () => {
    const env = bindings();
    await worker.fetch(new Request('https://clippy.test/health'), env);
    expect(env.CLIPPY_COORDINATOR.idFromName).toHaveBeenCalledWith('lobby');
  });

  it.each(['/', '/index.html', '/sw.js', '/manifest.webmanifest'])(
    'revalidates %s so installed PWAs receive new deployments', async (path) => {
      const result = await worker.fetch(new Request(`https://clippy.test${path}`), bindings());
      expect(result.headers.get('cache-control')).toBe('no-cache');
    },
  );

  it('preserves asset content types and revalidates unhashed JS', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValue(new Response('script', {
      headers: { 'content-type': 'application/javascript' },
    }));
    const result = await worker.fetch(new Request('https://clippy.test/js/app.js'), env);
    expect(await result.text()).toBe('script');
    expect(result.headers.get('content-type')).toBe('application/javascript');
    expect(result.headers.get('cache-control')).toContain('must-revalidate');
  });

  it('serves the app shell for unknown HTML navigation paths', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response('app shell'));
    const result = await worker.fetch(new Request('https://clippy.test/pair', {
      headers: { accept: 'text/html' },
    }), env);
    expect(await result.text()).toBe('app shell');
    expect(new URL(env.ASSETS.fetch.mock.calls[1][0].url).pathname).toBe('/index.html');
  });

  it('keeps missing assets as 404 instead of returning HTML', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
    const result = await worker.fetch(new Request('https://clippy.test/missing.js'), env);
    expect(result.status).toBe(404);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
