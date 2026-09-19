import DefaultTheme from 'vitepress/theme';
import { useRoute, type Theme } from 'vitepress';
import { nextTick, onMounted, watch } from 'vue';
import Screencast from './components/Screencast.vue';
import './custom.css';

let panZoomInstances: { destroy: () => void }[] = [];
let sectionObserver: IntersectionObserver | undefined;
let sectionMutationObserver: MutationObserver | undefined;
let revealScheduled = false;

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Screencast', Screencast);
  },
  setup() {
    const route = useRoute();

    const renderMermaid = async () => {
      if (typeof window === 'undefined') return;
      const [{ default: mermaid }, { default: svgPanZoom }] = await Promise.all(
        [import('mermaid'), import('svg-pan-zoom')],
      );

      panZoomInstances.forEach((instance) => instance.destroy());
      panZoomInstances = [];

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: document.documentElement.classList.contains('dark')
          ? 'dark'
          : 'default',
      });

      // stash the source separately: mermaid.run() replaces innerHTML with the rendered SVG, so a theme-change re-render needs the original text back to reparse.
      document
        .querySelectorAll<HTMLElement>('.mermaid[data-mermaid-source]')
        .forEach((el) => {
          el.removeAttribute('data-processed');
          el.innerHTML = el.dataset.mermaidSource!;
        });
      await mermaid.run({ querySelector: '.mermaid' });

      document
        .querySelectorAll<SVGSVGElement>('.mermaid svg')
        .forEach((svg) => {
          const instance = svgPanZoom(svg, {
            controlIconsEnabled: false,
            fit: true,
            center: true,
            minZoom: 0.5,
            maxZoom: 20,
          });
          panZoomInstances.push(instance);

          const container = svg.closest<HTMLElement>('.mermaid-container');
          const zoomIn =
            container?.querySelector<HTMLButtonElement>('.mermaid-zoom-in');
          const zoomOut =
            container?.querySelector<HTMLButtonElement>('.mermaid-zoom-out');
          const zoomReset = container?.querySelector<HTMLButtonElement>(
            '.mermaid-zoom-reset',
          );
          // assignment, not addEventListener, so a re-render replaces the handler instead of stacking another one
          if (zoomIn) zoomIn.onclick = () => instance.zoomIn();
          if (zoomOut) zoomOut.onclick = () => instance.zoomOut();
          if (zoomReset) zoomReset.onclick = () => instance.reset();
        });
    };

    const revealLandingSections = () => {
      if (typeof window === 'undefined') return;
      sectionObserver?.disconnect();
      const sections =
        document.querySelectorAll<HTMLElement>('.landing-section');
      if (!sections.length) return;
      sectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            sectionObserver?.unobserve(entry.target);
          }
        },
        { threshold: 0.15 },
      );
      sections.forEach((section) => sectionObserver!.observe(section));
    };

    // debounced: content HMR replaces section nodes without remounting this Layout
    const scheduleReveal = () => {
      if (revealScheduled) return;
      revealScheduled = true;
      void nextTick(() => {
        revealScheduled = false;
        revealLandingSections();
      });
    };

    onMounted(() => {
      void nextTick(renderMermaid);
      scheduleReveal();
      // re-render on light/dark toggle, since mermaid bakes theme colors into the SVG at render time
      const observer = new MutationObserver(() => void nextTick(renderMermaid));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });

      sectionMutationObserver?.disconnect();
      sectionMutationObserver = new MutationObserver(() => scheduleReveal());
      sectionMutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    watch(
      () => route.path,
      () => {
        void nextTick(renderMermaid);
        scheduleReveal();
      },
    );
  },
} satisfies Theme;
