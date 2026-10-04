import { describe, expect, it } from 'vitest';

import { sanitizeEmailHtml } from '../../src/utils/sanitizeEmailHtml.js';

describe('sanitizeEmailHtml', () => {
  it('removes script tags and event handlers', () => {
    const { html } = sanitizeEmailHtml(
      '<div><script>alert(1)</script><a href="https://example.com" onclick="bad()">Open</a></div>'
    );

    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps remote images by default', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<img src="https://tracker.example/pixel.png" alt="pixel">'
    );

    expect(html).toContain('<img');
    expect(html).toContain('src="https://tracker.example/pixel.png"');
    expect(blockedImages).toBe(0);
  });

  it('blocks remote images when asked, reporting the count', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<p>Hi</p><img src="https://tracker.example/pixel.png" alt="pixel">',
      { blockImages: true }
    );

    expect(html).not.toContain('tracker.example');
    expect(html).toContain('<p>Hi</p>');
    expect(blockedImages).toBe(1);
  });

  it('returns empty for blank input', () => {
    expect(sanitizeEmailHtml('')).toEqual({ html: '', blockedImages: 0 });
    expect(sanitizeEmailHtml(null)).toEqual({ html: '', blockedImages: 0 });
  });

  // Each of these loads a remote resource on a path the image blocker does not
  // see, or (style) restyles the whole app, including the verdict shown next to
  // the message.
  it('removes elements that can load remote resources or restyle the app', () => {
    const { html } = sanitizeEmailHtml(
      '<style>@import url(https://evil.example/x.css); .verdict{display:none}</style>' +
        '<video poster="https://evil.example/p.png"></video>' +
        '<input type="image" src="https://evil.example/i.png">' +
        '<svg><image href="https://evil.example/s.png"></image></svg>' +
        '<p>kept</p>'
    );
    expect(html).not.toMatch(/evil\.example/);
    expect(html).not.toMatch(/<style/i);
    expect(html).toContain('kept');
  });

  it('strips any remote url() from inline styles when blocking images', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<ul style="list-style-image: url(https://evil.example/t.png); color: red"><li>x</li></ul>',
      { blockImages: true }
    );
    expect(html).not.toMatch(/evil\.example/);
    expect(html).toContain('color: red');
    expect(blockedImages).toBe(1);
  });

  // Browsers resolve these to https:// too; a prefix check alone let them load.
  it('blocks protocol-relative and escaped remote images when blocking', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<img src="//evil.example/a.png">' +
        '<img src="\\\\evil.example/b.png">' +
        '<img src="data:image/png;base64,AAAA">' +
        '<p style="background: image-set(\'https://evil.example/c.png\' 1x)">x</p>' +
        '<p style="background: \\75 rl(https://evil.example/d.png); color: blue">y</p>',
      { blockImages: true }
    );
    expect(html).not.toMatch(/evil\.example/);
    expect(html).toContain('data:image/png');
    expect(html).toContain('color: blue');
    expect(blockedImages).toBe(4);
  });
});
