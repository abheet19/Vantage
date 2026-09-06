import { describe, expect, it } from 'vitest';
import { diffSqlLines, esc, highlightJson, highlightSql } from '../src/lib/highlight.js';

describe('esc', () => {
  it('escapes the three markup-starting characters and nothing else', () => {
    expect(esc('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    expect(esc("o'brien")).toBe("o'brien");
  });
});

describe('highlightSql', () => {
  it('wraps keywords, parameters, strings and comments in token spans', () => {
    const html = highlightSql("SELECT count(*) FROM events WHERE event = $1 -- note");
    expect(html).toContain('<span class="kw">SELECT</span>');
    expect(html).toContain('<span class="n">$1</span>');
    expect(html).toContain('<span class="c">-- note</span>');
  });
  it('escapes before highlighting, so injected markup cannot survive', () => {
    const html = highlightSql("SELECT '<script>' FROM events");
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('highlightJson', () => {
  it('colours keys, string values, numbers and literals', () => {
    const html = highlightJson('{"kind":"funnel","window":{"value":7},"ok":true}');
    expect(html).toContain('<span class="k">"kind"</span>');
    expect(html).toContain('<span class="s">"funnel"</span>');
    expect(html).toContain('<span class="n">7</span>');
    expect(html).toContain('<span class="n">true</span>');
  });
});

describe('diffSqlLines', () => {
  it('marks a changed line as a del then an add and leaves unchanged lines plain', () => {
    const before = "SELECT 1\ninterval '14 days'\nFROM e";
    const after = "SELECT 1\ninterval '7 days'\nFROM e";
    const html = diffSqlLines(before, after);
    expect(html).toContain('<span class="del">');
    expect(html).toContain('<span class="add">');
    expect(html).toContain("7 days");
    // the unchanged first line is not wrapped in a diff band
    expect(html.startsWith('<span class="del">')).toBe(false);
  });
});
