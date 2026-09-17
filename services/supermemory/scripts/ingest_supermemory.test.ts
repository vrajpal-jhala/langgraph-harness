import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  escapeHtmlTags,
  parseFrontmatter,
  stripFrontmatter,
} from './ingest_supermemory.js';

test('parseFrontmatter reads the scrape_issues.ts frontmatter shape', () => {
  const markdown = `---
- id: 1
- iid: 5
- project_id: 42
- state: opened
- labels: bug, ui
---

# Some title

body text`;

  assert.deepEqual(parseFrontmatter(markdown), {
    id: '1',
    iid: '5',
    project_id: '42',
    state: 'opened',
    labels: 'bug, ui',
  });
});

test('parseFrontmatter returns null when there is no frontmatter block', () => {
  assert.equal(parseFrontmatter('# just a title\n\nbody'), null);
});

test('stripFrontmatter removes the frontmatter block, leaving the rest untouched', () => {
  const markdown = `---
- id: 1
- state: opened
---

# Some title

body text`;

  assert.equal(stripFrontmatter(markdown), '# Some title\n\nbody text');
});

test('stripFrontmatter is a no-op when there is no frontmatter block', () => {
  assert.equal(
    stripFrontmatter('# just a title\n\nbody'),
    '# just a title\n\nbody',
  );
});

test('escapeHtmlTags neutralizes an HTML tag quoted as example text', () => {
  assert.equal(
    escapeHtmlTags('use `<meta name="robots" content="noindex">` in the head'),
    'use `&lt;meta name="robots" content="noindex"&gt;` in the head',
  );
});

test('escapeHtmlTags is a no-op when there are no angle brackets', () => {
  assert.equal(
    escapeHtmlTags('plain text, nothing special'),
    'plain text, nothing special',
  );
});
