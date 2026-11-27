// GitHub's "pull request" vs GitLab's "merge request"/"note"; a Map because an object literal returns Object.prototype members for words like "constructor".
const SYNONYMS = new Map<string, string[]>([
  ['pr', ['merge', 'request']],
  ['mr', ['merge', 'request']],
  ['pull', ['merge']],
  ['comment', ['note']],
  ['log', ['output', 'trace']],
]);

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) =>
      word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word,
    )
    .flatMap((word) => [word, ...(SYNONYMS.get(word) ?? [])]);
}

// Local models send arrays, JSON-ish strings or nothing at all for a list argument — accept all of it.
export function parseQuery(query: string | string[] | undefined): string[] {
  const raw = Array.isArray(query) ? query.join(',') : (query ?? '');
  return raw
    .replace(/[[\]"'`]/g, '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// ponytail: in-memory BM25 rebuilt per call, fine for hundreds of docs; move to hybrid with embeddings if wrong picks show up in real use.
export function createBm25Index<T>(
  items: T[],
  toText: (item: T) => { title: string; body: string },
) {
  const k1 = 1.2;
  const b = 0.75;
  const docs = items.map((item) => {
    const { title, body } = toText(item);
    const titleTokens = tokenize(title);
    // Title tokens go in twice, doubling their term frequency, so a title match outranks the same word in the body.
    return [...titleTokens, ...titleTokens, ...tokenize(body)];
  });
  const avgLength =
    docs.reduce((sum, doc) => sum + doc.length, 0) / (docs.length || 1);
  const docFreq = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  return (query: string, limit: number): T[] => {
    const terms = [...new Set(tokenize(query))];
    return docs
      .map((doc, i) => {
        let score = 0;
        for (const term of terms) {
          const df = docFreq.get(term);
          if (!df) continue;
          const tf = doc.filter((t) => t === term).length;
          if (!tf) continue;
          const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
          score +=
            (idf * tf * (k1 + 1)) /
            (tf + k1 * (1 - b + (b * doc.length) / avgLength));
        }
        return { item: items[i], score };
      })
      .filter((match) => match.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map((match) => match.item);
  };
}
