import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'langgraph-harness',
  description:
    'Self-hosted AI coding agent platform for GitLab, built with LangGraph. Reviews merge requests, resolves issues autonomously, and chats with full project context.',
  base: '/langgraph-harness/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    [
      'link',
      {
        rel: 'icon',
        href: '/langgraph-harness/favicon.svg',
        type: 'image/svg+xml',
      },
    ],
    // set before paint so landing sections can start hidden with no flash-of-visible-then-hidden
    ['script', {}, "document.documentElement.classList.add('has-js')"],
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      {
        property: 'og:title',
        content:
          'langgraph-harness — Self-Hosted AI Coding Agent Platform for GitLab',
      },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Self-hosted AI coding agent platform for GitLab, built with LangGraph. Reviews merge requests, resolves issues autonomously, and chats with full project context.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content:
          'https://vrajpal-jhala.github.io/langgraph-harness/screenshots/analytics-overview.png',
      },
    ],
    [
      'meta',
      {
        property: 'og:url',
        content: 'https://vrajpal-jhala.github.io/langgraph-harness/',
      },
    ],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    [
      'meta',
      {
        name: 'twitter:title',
        content:
          'langgraph-harness — Self-Hosted AI Coding Agent Platform for GitLab',
      },
    ],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'Self-hosted AI coding agent platform for GitLab, built with LangGraph. Reviews merge requests, resolves issues autonomously, and chats with full project context.',
      },
    ],
    [
      'meta',
      {
        name: 'twitter:image',
        content:
          'https://vrajpal-jhala.github.io/langgraph-harness/screenshots/analytics-overview.png',
      },
    ],
  ],

  markdown: {
    config(md) {
      const fence = md.renderer.rules.fence!.bind(md.renderer.rules);
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.info.trim() === 'mermaid') {
          const escaped = md.utils.escapeHtml(token.content);
          // stash the source separately: mermaid.run() replaces innerHTML with the rendered SVG, so a theme-change re-render needs the original text back to reparse.
          return `<div class="mermaid-container">
            <pre class="mermaid" data-mermaid-source="${escaped}">${escaped}</pre>
            <div class="mermaid-zoom-controls">
              <button class="mermaid-zoom-in" type="button" aria-label="Zoom in">+</button>
              <button class="mermaid-zoom-out" type="button" aria-label="Zoom out">&minus;</button>
              <button class="mermaid-zoom-reset" type="button" aria-label="Reset zoom">&#8635;</button>
            </div>
          </div>`;
        }
        return fence(tokens, idx, options, env, self);
      };
    },
  },

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/features' },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Deployment', link: '/deployment' },
          { text: 'sglang Deployment', link: '/sglang-deployment' },
        ],
      },
      {
        text: 'Gallery',
        items: [
          { text: 'Screenshots', link: '/screenshots' },
          { text: 'Screencasts', link: '/screencasts' },
        ],
      },
      { text: 'Story', link: '/journey' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Per-Repo Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Features',
        items: [{ text: 'Tools & Guardrails', link: '/features' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Deployment', link: '/deployment' },
          { text: 'sglang Deployment', link: '/sglang-deployment' },
        ],
      },
      {
        text: 'More',
        items: [
          { text: 'Screenshots', link: '/screenshots' },
          { text: 'Screencasts', link: '/screencasts' },
          { text: 'The Story So Far', link: '/journey' },
        ],
      },
    ],

    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/vrajpal-jhala/langgraph-harness',
      },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message:
        'Made with <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#e25555" style="display:inline-block;vertical-align:-0.1em"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg> by <a href="https://linkedin.com/in/vrajpal-jhala" target="_blank" rel="noopener">Vrajpal Jhala</a>.<br/>Released under the MIT License.<br/>This site collects no analytics or cookies.',
    },
  },
});
