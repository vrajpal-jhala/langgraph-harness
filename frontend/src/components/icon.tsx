import type {
  Icon as TablerIcon,
  IconProps as TablerIconProps,
} from '@tabler/icons-react';

interface IIconProps extends TablerIconProps {
  as: TablerIcon;
  size?: 12 | 16 | 20 | 40;
}

const Icon = (props: IIconProps) => {
  const { as: Component, size = 16, ...rest } = props;

  return <Component size={size} {...rest} />;
};

export default Icon;
