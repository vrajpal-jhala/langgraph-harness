import { use, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Burger,
  Drawer,
  Group,
  Menu,
  NavLink,
  Text,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { useDisclosure, useHover, useMediaQuery } from '@mantine/hooks';
import {
  IconActivity,
  IconBrain,
  IconCalendarClock,
  IconChartBar,
  IconHelpCircle,
  IconHierarchy2,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMessage,
  IconSettings,
  IconStack2,
} from '@tabler/icons-react';

import { Role } from '@/types';

import Icon from '@/components/icon';
import Logo from '@/components/logo';

import { authClient } from '@/api';
import { type AuthUser, Context } from '@/contexts';
import { useAuth } from '@/hooks/useAuth';
import { ORIENTATION_TOUR_ID, orientationSteps } from '@/tours/steps';
import { hasSeenTour, useTour } from '@/tours/tourState';

const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: <Icon as={IconLayoutDashboard} />,
    dataTour: 'nav-dashboard',
  },
  {
    to: '/threads',
    label: 'Threads',
    icon: <Icon as={IconStack2} />,
    dataTour: 'nav-threads',
  },
  {
    to: '/chat',
    label: 'Chat',
    icon: <Icon as={IconMessage} />,
    dataTour: 'nav-chat',
  },
  {
    to: '/schedules',
    label: 'Schedules',
    icon: <Icon as={IconCalendarClock} />,
  },
  {
    to: '/workflows',
    label: 'Workflows',
    icon: <Icon as={IconHierarchy2} />,
    dataTour: 'nav-workflows',
  },
  {
    to: '/memories',
    label: 'Memories',
    icon: <Icon as={IconBrain} />,
    dataTour: 'nav-memories',
  },
  { to: '/analytics', label: 'Analytics', icon: <Icon as={IconChartBar} /> },
  {
    to: '/monitoring',
    label: 'Monitoring',
    icon: <Icon as={IconActivity} />,
    adminOnly: true,
  },
];

const NavItem = ({
  to,
  label,
  icon,
  pathname,
  collapsed = false,
  onClick,
  dataTour,
}: {
  to?: string;
  label: string;
  icon: React.ReactNode;
  pathname?: string;
  collapsed?: boolean;
  onClick?: () => void;
  dataTour?: string;
}) => {
  const link = to ? (
    <NavLink
      component={Link}
      to={to}
      label={collapsed ? undefined : label}
      leftSection={icon}
      active={pathname?.startsWith(to)}
      color="gray"
      onClick={onClick}
      h={40}
      data-tour={dataTour}
    />
  ) : (
    <NavLink
      label={collapsed ? undefined : label}
      leftSection={icon}
      color="gray"
      onClick={onClick}
      h={40}
      data-tour={dataTour}
    />
  );

  return collapsed ? (
    <Tooltip label={label} position="right" withArrow>
      {link}
    </Tooltip>
  ) : (
    link
  );
};

const UserMenu = ({
  name,
  avatarUrl,
  collapsed,
}: {
  name: string;
  avatarUrl: string | null;
  collapsed: boolean;
}) => {
  const [menuOpened, setMenuOpened] = useState(false);
  const { handleError } = use(Context);

  const handleLogout = async () => {
    const { error } = await authClient.signOut();
    if (error) handleError(error, 'Failed to sign out');
    window.location.href = '/login';
  };

  return (
    <Menu position="top" withArrow onChange={setMenuOpened}>
      <Menu.Target>
        <NavLink
          label={collapsed ? undefined : name}
          leftSection={<Avatar src={avatarUrl} size={16} radius="xl" />}
          active={menuOpened}
          color="gray"
          h={40}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<Icon as={IconLogout} />}
          onClick={handleLogout}
        >
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};

const NavBody = ({
  pathname,
  collapsed = false,
  onNavigate,
  logoContent,
  onStartTour,
  user,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  logoContent?: React.ReactNode;
  onStartTour: () => void;
  user: AuthUser;
}) => (
  <>
    <AppShell.Section>
      <Group
        h={40}
        mb="xs"
        justify={collapsed ? 'center' : 'space-between'}
        align="center"
        wrap="nowrap"
      >
        {logoContent ?? <Logo />}
      </Group>
    </AppShell.Section>
    <AppShell.Section grow>
      {NAV_ITEMS.filter(
        (item) => !item.adminOnly || user?.role === Role.Admin,
      ).map(({ to, label, icon, dataTour }) => (
        <NavItem
          key={to}
          to={to}
          label={label}
          icon={icon}
          pathname={pathname}
          collapsed={collapsed}
          onClick={onNavigate}
          dataTour={dataTour}
        />
      ))}
    </AppShell.Section>
    <AppShell.Section>
      <NavItem
        label="Take a tour"
        icon={<Icon as={IconHelpCircle} />}
        collapsed={collapsed}
        onClick={() => {
          onStartTour();
          onNavigate?.();
        }}
      />
      <NavItem
        to="/settings"
        label="Settings"
        icon={<Icon as={IconSettings} />}
        pathname={pathname}
        collapsed={collapsed}
        onClick={onNavigate}
      />
      {user && (
        <UserMenu
          name={user.name}
          avatarUrl={user.avatarUrl}
          collapsed={collapsed}
        />
      )}
    </AppShell.Section>
  </>
);

const Layout = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [
    mobileOpened,
    { open: openMobile, toggle: toggleMobile, close: closeMobile },
  ] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isTouchDevice = useMediaQuery('(hover: none)') ?? false;
  const { hovered, ref: navbarRef } = useHover<HTMLElement>();
  const { startTour, registerMobileNav } = useTour();
  const handleStartTour = () =>
    startTour(ORIENTATION_TOUR_ID, orientationSteps, { force: true });
  const pageTitle =
    [...NAV_ITEMS, { to: '/settings', label: 'Settings' }].find(({ to }) =>
      pathname.startsWith(to),
    )?.label ?? '';

  // Lets tours reach nav targets that only exist inside the mobile drawer.
  useEffect(() => {
    registerMobileNav({ open: openMobile, close: closeMobile });
    return () => registerMobileNav(null);
  }, [registerMobileNav, openMobile, closeMobile]);

  useEffect(() => {
    // Detail pages (/threads/:id, /workflows/:id) run their own contextual
    // tour once their data loads. Don't clobber it by also kicking off the
    // orientation tour and yanking someone away mid-task on a deep link —
    // it'll pick up next time they land on a list page instead.
    const isDetailRoute = /^\/(threads|workflows)\/.+/.test(pathname);
    if (!isDetailRoute && !hasSeenTour(ORIENTATION_TOUR_ID)) {
      startTour(ORIENTATION_TOUR_ID, orientationSteps);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleDesktop = () => {
    toggleDesktop();
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 200);
  };

  const desktopLogoContent = desktopOpened ? (
    <>
      <Logo />
      <ActionIcon variant="subtle" color="gray" onClick={handleToggleDesktop}>
        <Icon as={IconLayoutSidebarLeftCollapse} />
      </ActionIcon>
    </>
  ) : (hovered || isTouchDevice) && !isAnimating ? (
    <Tooltip label="Open sidebar" position="right" withArrow>
      <ActionIcon variant="subtle" color="gray" onClick={handleToggleDesktop}>
        <Icon as={IconLayoutSidebarLeftExpand} />
      </ActionIcon>
    </Tooltip>
  ) : undefined;

  return (
    <AppShell
      header={{ height: 60, collapsed: !isMobile }}
      navbar={
        isMobile
          ? undefined
          : { width: desktopOpened ? 300 : 60, breakpoint: 'sm' }
      }
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={mobileOpened} onClick={toggleMobile} size="sm" />
          <Text fw={600}>{pageTitle}</Text>
        </Group>
      </AppShell.Header>

      {isMobile ? (
        <Drawer
          opened={mobileOpened}
          onClose={closeMobile}
          withCloseButton={false}
          size={300}
          padding="xs"
          classNames={{ body: 'layout__drawer-body' }}
        >
          <NavBody
            pathname={pathname}
            onNavigate={closeMobile}
            onStartTour={handleStartTour}
            user={user}
          />
        </Drawer>
      ) : (
        <AppShell.Navbar ref={navbarRef} p="xs" bg="dark.9">
          <NavBody
            pathname={pathname}
            collapsed={!desktopOpened}
            logoContent={desktopLogoContent}
            onStartTour={handleStartTour}
            user={user}
          />
        </AppShell.Navbar>
      )}

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};

export default Layout;
