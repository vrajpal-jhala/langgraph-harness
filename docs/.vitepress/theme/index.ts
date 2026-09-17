import DefaultTheme from 'vitepress/theme';
import { useRoute, type Theme } from 'vitepress';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

let panZoomInstances: { destroy: () => void }[] = [];

export default {
  extends: DefaultTheme,
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

    onMounted(() => {
      void nextTick(renderMermaid);
      // re-render on light/dark toggle, since mermaid bakes theme colors into the SVG at render time
      const observer = new MutationObserver(() => void nextTick(renderMermaid));
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
    });

    watch(
      () => route.path,
      () => void nextTick(renderMermaid),
    );
  },
} satisfies Theme;
