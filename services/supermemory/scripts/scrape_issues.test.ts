import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderDiscussions, renderIssueLinks } from './scrape_issues.js';

test('renderDiscussions drops system notes and keeps real comments', () => {
  const out = renderDiscussions([
    {
      notes: [
        {
          system: true,
          author: null,
          created_at: 't1',
          body: 'changed label to X',
        },
        {
          system: false,
          author: { name: 'Alice' },
          created_at: 't2',
          body: 'why not use Y instead?',
        },
      ],
    },
  ]);

  assert.match(out, /## Discussion/);
  assert.match(out, /Alice.*why not use Y instead\?/s);
  assert.doesNotMatch(out, /changed label to X/);
});

test('renderDiscussions returns empty string when only system notes exist', () => {
  const out = renderDiscussions([
    {
      notes: [
        { system: true, author: null, created_at: 't1', body: 'closed issue' },
      ],
    },
  ]);

  assert.equal(out, '');
});

test('renderIssueLinks renders each same-project link type with its issue reference', () => {
  const out = renderIssueLinks(
    [
      {
        iid: 200,
        project_id: 42,
        title: 'Duplicate report',
        link_type: 'relates_to',
      },
      { iid: 150, project_id: 42, title: 'Blocking bug', link_type: 'blocks' },
    ],
    '42',
  );

  assert.match(out, /## Linked Issues/);
  assert.match(out, /relates to #200: Duplicate report/);
  assert.match(out, /blocks #150: Blocking bug/);
});

test('renderIssueLinks drops cross-project links, which were never ingested', () => {
  const out = renderIssueLinks(
    [
      {
        iid: 166,
        project_id: 99,
        title: 'Other project issue',
        link_type: 'is_blocked_by',
      },
    ],
    '42',
  );

  assert.equal(out, '');
});

test('renderIssueLinks returns empty string when there are no links', () => {
  assert.equal(renderIssueLinks([], '42'), '');
});
