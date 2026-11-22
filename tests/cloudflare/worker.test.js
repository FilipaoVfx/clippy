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

  it('answers unknown pages with the 404 page and a real 404 status', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response('not found page', { headers: { 'content-type': 'text/html' } }));
    const result = await worker.fetch(new Request('https://clippy.test/pair', {
      headers: { accept: 'text/html' },
    }), env);
    expect(result.status).toBe(404);
    expect(await result.text()).toBe('not found page');
    expect(result.headers.get('x-robots-tag')).toBe('noindex');
    expect(result.headers.get('content-type')).toBe('text/html');
    expect(new URL(env.ASSETS.fetch.mock.calls[1][0].url).pathname).toBe('/404');
  });

  it('treats a direct visit to the 404 page as a 404', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValue(new Response('not found page'));
    const result = await worker.fetch(new Request('https://clippy.test/404', {
      headers: { accept: 'text/html' },
    }), env);
    expect(result.status).toBe(404);
  });

  it('sends any unknown path that carries a pairing code to the app', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
    const result = await worker.fetch(new Request('https://clippy.test/join?code=ABC-12D', {
      headers: { accept: 'text/html' },
    }), env);
    expect(result.status).toBe(302);
    expect(result.headers.get('location')).toBe('https://clippy.test/?code=ABC-12D');
  });

  it('redirects www to the bare domain permanently, keeping path and query', async () => {
    const env = bindings();
    const result = await worker.fetch(new Request('https://www.pastty.com/faq?ref=x'), env);
    expect(result.status).toBe(301);
    expect(result.headers.get('location')).toBe('https://pastty.com/faq?ref=x');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('keeps the workers.dev mirror out of search results', async () => {
    const mirror = await worker.fetch(new Request('https://clippy-realtime.example.workers.dev/faq'), bindings());
    expect(mirror.headers.get('x-robots-tag')).toBe('noindex');
    const canonical = await worker.fetch(new Request('https://pastty.com/faq'), bindings());
    expect(canonical.headers.get('x-robots-tag')).toBeNull();
  });

  it.each(['/faq', '/es/', '/es/limites'])('revalidates the content page %s', async (path) => {
    const result = await worker.fetch(new Request(`https://clippy.test${path}`), bindings());
    expect(result.headers.get('cache-control')).toBe('no-cache');
  });

  it('keeps missing assets as 404 instead of returning HTML', async () => {
    const env = bindings();
    env.ASSETS.fetch.mockResolvedValue(new Response('missing', { status: 404 }));
    const result = await worker.fetch(new Request('https://clippy.test/missing.js'), env);
    expect(result.status).toBe(404);
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
