import { useEffect, useId, useRef, useState } from 'react';
import { Center, Loader } from '@mantine/core';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: { background: 'transparent' },
});

// Mermaid's classDef syntax can't parse CSS var(), and any plain external
// CSS loses to the `!important` rules mermaid generates for node styling.
// So node colors are applied here, after render, as inline `!important`
// styles — the only thing that reliably wins — keyed off the `first`/`last`
// classes LangGraph's drawMermaid() emits for the start/end nodes.
const NODE_VARIANTS = {
  default: {
    fill: 'var(--mantine-color-dark-6)',
    stroke: 'var(--mantine-color-teal-3)',
    text: 'var(--mantine-color-text)',
  },
  first: {
    fill: 'transparent',
    stroke: 'var(--mantine-color-text)',
    text: 'var(--mantine-color-text)',
  },
  last: {
    fill: 'var(--mantine-color-gray-7)',
    stroke: 'var(--mantine-color-gray-7)',
    text: 'var(--mantine-primary-color-contrast)',
  },
} as const;

interface IMermaidGraphProps {
  definition: string;
}

const MermaidGraph = ({ definition }: IMermaidGraphProps) => {
  const id = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string | null>(null);
  const [renderedDefinition, setRenderedDefinition] = useState(definition);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drops the stale svg during render, before paint, so a new definition never flashes the old graph.
  if (definition !== renderedDefinition) {
    setRenderedDefinition(definition);
    setSvg(null);
  }

  useEffect(() => {
    let cancelled = false;

    mermaid.render(`mermaid-${id}`, definition).then(({ svg: rendered }) => {
      if (!cancelled) setSvg(rendered);
    });

    return () => {
      cancelled = true;
    };
  }, [id, definition]);

  useEffect(() => {
    if (!svg || !containerRef.current) return;

    containerRef.current
      .querySelectorAll<SVGGElement>('.node')
      .forEach((node) => {
        const variant = node.classList.contains('last')
          ? NODE_VARIANTS.last
          : node.classList.contains('first')
            ? NODE_VARIANTS.first
            : NODE_VARIANTS.default;

        // Rough.js-drawn shapes (e.g. the stadium first/last nodes) bake their
        // own inline fill/stroke onto inner <path> elements, not just the
        // outer `.basic` element, so every shape element must be overridden.
        node
          .querySelectorAll<SVGElement>('rect, polygon, circle, ellipse, path')
          .forEach((el) => {
            el.style.setProperty('fill', variant.fill, 'important');
            el.style.setProperty('stroke', variant.stroke, 'important');
          });

        node.querySelectorAll<HTMLElement>('.nodeLabel').forEach((label) => {
          label.style.setProperty('color', variant.text, 'important');
        });
      });
  }, [svg]);

  if (!svg) {
    return (
      <Center h={200}>
        <Loader color="gray" />
      </Center>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-graph"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

export default MermaidGraph;
