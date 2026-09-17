import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'langgraph-harness',
  description:
    'The engineering context platform for GitLab — reviews merge requests, resolves issues autonomously, and chats with full project context.',
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
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'langgraph-harness' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'The engineering context platform for GitLab — reviews merge requests, resolves issues autonomously, and chats with full project context.',
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
    ['meta', { name: 'twitter:title', content: 'langgraph-harness' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'The engineering context platform for GitLab — reviews merge requests, resolves issues autonomously, and chats with full project context.',
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
      { text: 'Screenshots', link: '/screenshots' },
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
        'Made with <span style="color:#e25555">&hearts;</span> by <a href="https://linkedin.com/in/vrajpal-jhala" target="_blank" rel="noopener">Vrajpal Jhala</a>.<br/>Released under the MIT License.',
    },
  },
});
