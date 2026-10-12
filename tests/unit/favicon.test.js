import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome } = createChromeMock();
globalThis.chrome = chrome;

const { FAVICON_SIZE, faviconUrl } = await import('../../src/utils/favicon.js');

/**
 * These guard the "zero outbound requests" property: the URL must point at the
 * browser's own favicon endpoint, and it must carry the page URL as a *query
 * parameter* rather than anywhere it could be mistaken for a remote address.
 */
describe('faviconUrl', () => {
  it("points at this extension's built-in favicon endpoint", () => {
    const url = faviconUrl('https://example.com/page');
    assert.ok(
      url.startsWith('chrome-extension://test-extension-id/_favicon/'),
      `unexpected URL: ${url}`
    );
  });

  it('carries the page URL as a query parameter, correctly encoded', () => {
    const url = new URL(faviconUrl('https://example.com/a?b=1&c=2'));
    assert.equal(url.searchParams.get('pageUrl'), 'https://example.com/a?b=1&c=2');
  });

  it('never leaves the page origin reachable as a network target', () => {
    const url = faviconUrl('https://example.com/x');
    // Encoded as %3A%2F%2F… inside the query, so no literal host/path appears.
    assert.ok(!url.includes('example.com/x'), 'page URL must not leak into the path');
    assert.ok(!url.startsWith('http'), 'must not be an http(s) URL');
  });

  it('requests a HiDPI-friendly size by default', () => {
    const url = new URL(faviconUrl('https://example.com'));
    assert.equal(url.searchParams.get('size'), String(FAVICON_SIZE));
  });

  it('honours an explicit size', () => {
    const url = new URL(faviconUrl('https://example.com', 16));
    assert.equal(url.searchParams.get('size'), '16');
  });

  it('handles URLs that need escaping', () => {
    const url = new URL(faviconUrl('https://example.com/搜索?q=a b'));
    assert.equal(url.searchParams.get('pageUrl'), 'https://example.com/搜索?q=a b');
  });
});
