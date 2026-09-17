import { useEffect, useState } from 'react';

import { formatDuration } from '@/utils';

type CounterProps =
  | { mode: 'down'; timeLeft: number; startedAt: number }
  | { mode: 'up'; startedAt: Date };

const Counter = (props: CounterProps) => {
  const { mode, startedAt } = props;
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (mode === 'up') {
    return formatDuration(now - +new Date(startedAt));
  }

  const { timeLeft } = props;
  const remaining = Math.max(0, timeLeft - (now - startedAt));
  const s = Math.floor(remaining / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;

  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default Counter;
