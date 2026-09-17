import ReactMarkdown from 'react-markdown';
import { Typography } from '@mantine/core';
import remarkGfm from 'remark-gfm';

interface IMarkdownProps {
  content: string;
}

export const Markdown = ({ content }: IMarkdownProps) => (
  <Typography className="markdown">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </Typography>
);
