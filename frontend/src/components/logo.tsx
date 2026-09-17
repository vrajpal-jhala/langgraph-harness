import { Group, type GroupProps } from '@mantine/core';

import logo from '@/assets/logo.svg';

const Logo = ({ ...props }: GroupProps & { iconOnly?: boolean }) => {
  return (
    <Group className="logo" gap="xs" px={6} py="xs" {...props}>
      <img alt="langgraph-harness logo" src={logo} height={28} width={28} />
    </Group>
  );
};

export default Logo;
