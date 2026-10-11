import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createChromeMock } from '../helpers/chrome-mock.js';

const { chrome, state } = createChromeMock();
globalThis.chrome = chrome;

const {
  addToWhitelist,
  extractDomain,
  isChromeInternalPage,
  isEmptyTabPage,
  matchesAnyPattern,
  matchesPattern,
  normalizeDomainInput,
  removeFromWhitelist
} = await import('../../src/utils/whitelist.js');

beforeEach(() => {
  state.local = { whitelist: ['example.com', '*.test.com', 'google.com'] };
});

describe('extractDomain', () => {
  it('extracts the hostname from valid URLs', () => {
    assert.equal(extractDomain('https://example.com'), 'example.com');
    assert.equal(extractDomain('https://www.example.com/path'), 'www.example.com');
    assert.equal(extractDomain('http://sub.domain.example.com:8080'), 'sub.domain.example.com');
  });

  it('returns an empty string for unusable input', () => {
    assert.equal(extractDomain(''), '');
    assert.equal(extractDomain('not a url'), '');
    assert.equal(extractDomain(null), '');
  });
});

describe('normalizeDomainInput', () => {
  it('strips scheme, path, query, port and userinfo', () => {
    assert.equal(normalizeDomainInput('https://Example.com/path?a=1'), 'example.com');
    assert.equal(normalizeDomainInput('example.com:8080'), 'example.com');
    assert.equal(normalizeDomainInput('http://user:pw@example.com/x'), 'example.com');
  });

  it('preserves the wildcard prefix', () => {
    assert.equal(normalizeDomainInput('*.example.com'), '*.example.com');
    assert.equal(normalizeDomainInput('*.Example.com/path'), '*.example.com');
  });

  it('accepts single-label hosts such as localhost', () => {
    assert.equal(normalizeDomainInput('localhost'), 'localhost');
  });

  it('rejects unusable input', () => {
    assert.equal(normalizeDomainInput(''), '');
    assert.equal(normalizeDomainInput('   '), '');
    assert.equal(normalizeDomainInput('has space.com'), '');
    assert.equal(normalizeDomainInput('exa_mple.com'), '');
    assert.equal(normalizeDomainInput(null), '');
  });
});

describe('matchesPattern', () => {
  it('matches exact domains and their subdomains', () => {
    assert.equal(matchesPattern('example.com', 'example.com'), true);
    assert.equal(matchesPattern('sub.example.com', 'example.com'), true);
    assert.equal(matchesPattern('other.com', 'example.com'), false);
  });

  it('does not match a suffix that is not a domain boundary', () => {
    assert.equal(matchesPattern('notexample.com', 'example.com'), false);
  });

  it('matches wildcard patterns', () => {
    assert.equal(matchesPattern('sub.test.com', '*.test.com'), true);
    assert.equal(matchesPattern('test.com', '*.test.com'), true);
    assert.equal(matchesPattern('deep.sub.test.com', '*.test.com'), true);
    assert.equal(matchesPattern('other.com', '*.test.com'), false);
  });

  it('returns false for empty inputs', () => {
    assert.equal(matchesPattern('', 'example.com'), false);
    assert.equal(matchesPattern('example.com', ''), false);
    assert.equal(matchesPattern(null, 'example.com'), false);
  });
});

describe('matchesAnyPattern', () => {
  it('checks a whole whitelist', () => {
    assert.equal(matchesAnyPattern('mail.example.com', ['example.com']), true);
    assert.equal(matchesAnyPattern('evil.com', ['example.com', '*.test.com']), false);
    assert.equal(matchesAnyPattern('a.test.com', ['example.com', '*.test.com']), true);
  });

  it('is defensive about its inputs', () => {
    assert.equal(matchesAnyPattern('example.com', null), false);
    assert.equal(matchesAnyPattern('', ['example.com']), false);
  });
});

describe('isChromeInternalPage', () => {
  it('identifies browser internal pages', () => {
    for (const url of [
      'chrome://extensions',
      'chrome-extension://abc123/popup.html',
      'edge://settings',
      'about:blank',
      'devtools://devtools'
    ]) {
      assert.equal(isChromeInternalPage(url), true, url);
    }
  });

  it('does not flag regular pages', () => {
    assert.equal(isChromeInternalPage('https://example.com'), false);
    assert.equal(isChromeInternalPage('https://chrome.google.com'), false);
    assert.equal(isChromeInternalPage('http://localhost:3000'), false);
  });

  it('treats empty input as internal', () => {
    assert.equal(isChromeInternalPage(''), true);
    assert.equal(isChromeInternalPage(null), true);
  });
});

describe('isEmptyTabPage', () => {
  it('identifies blank and new-tab pages', () => {
    for (const url of [
      'chrome://newtab/',
      'chrome://blank',
      'about:blank',
      'about:newtab',
      'edge://newtab/'
    ]) {
      assert.equal(isEmptyTabPage(url), true, url);
    }
  });

  it('does not flag regular pages', () => {
    assert.equal(isEmptyTabPage('https://example.com'), false);
    assert.equal(isEmptyTabPage('https://google.com'), false);
  });

  it('requires the URL to look browser-generated before trusting the title', () => {
    assert.equal(isEmptyTabPage('about:blank', 'New Tab'), true);
    assert.equal(isEmptyTabPage('https://news.example.com', 'New Tab'), false);
  });
});

describe('whitelist mutations', () => {
  it('adds a normalised domain', async () => {
    const result = await addToWhitelist('https://NewSite.com/some/path');
    assert.deepEqual(result, { added: true, domain: 'newsite.com' });
    assert.ok(state.local.whitelist.includes('newsite.com'));
  });

  it('reports duplicates without writing twice', async () => {
    const result = await addToWhitelist('example.com');
    assert.equal(result.added, false);
    assert.equal(state.local.whitelist.filter((entry) => entry === 'example.com').length, 1);
  });

  it('refuses invalid input', async () => {
    const result = await addToWhitelist('not a domain');
    assert.equal(result.added, false);
    assert.equal(result.domain, '');
  });

  it('removes an existing domain and reports a miss', async () => {
    assert.equal((await removeFromWhitelist('example.com')).removed, true);
    assert.ok(!state.local.whitelist.includes('example.com'));
    assert.equal((await removeFromWhitelist('example.com')).removed, false);
  });
});
