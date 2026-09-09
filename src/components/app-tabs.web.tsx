import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { Tabs, TabList, TabTrigger, TabSlot, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { CoursePicker } from './course-picker';
import { GlideLingoBrandMark } from './glidelingo-brand-mark';
import { ThemedText } from './themed-text';
import {
  ChartIcon,
  HouseIcon,
  MapIcon,
  MoonIcon,
  PanelLeftIcon,
  PhrasesIcon,
  ProfileIcon,
  ReviewIcon,
  SunIcon,
} from './ui/hackathon-icons.web';

import { Fonts, Motion, Radii } from '@/constants/theme';
import { primaryDestinations, type PrimaryDestinationId } from '@/features/product-shell/navigation';
import { useTheme, useThemeController } from '@/hooks/use-theme';
import { useDesktopUpdate } from '@/features/desktop-update/context';
import { DesktopUpdateSidebarStatus } from '@/features/desktop-update/desktop-update-view.web';
import { useLearning } from '@/providers/learning-provider';

const RAIL_WIDTH = 288;
const COLLAPSED_RAIL_WIDTH = 52;
const COLLAPSE_BREAKPOINT = 760;

type PressState = { pressed: boolean; hovered?: boolean };

type WebTransitionStyle = ViewStyle & {
  transitionDuration: string;
  transitionProperty: string;
  transitionTimingFunction: string;
};

type SidebarState = {
  collapsed: boolean;
  transitionDuration: string;
};

const CollapsedContext = createContext<SidebarState>({ collapsed: false, transitionDuration: `${Motion.standard}ms` });

export function sidebarTransitionDuration(reducedMotion: boolean) {
  return reducedMotion ? '0ms' : `${Motion.standard}ms`;
}

function transitionStyle(duration: string, property: string): WebTransitionStyle {
  return {
    transitionDuration: duration,
    transitionProperty: property,
    transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
  };
}

export function isVisibleLessonActive(activeLessonId: string | null, pathname: string) {
  return Boolean(activeLessonId && pathname === '/');
}

export default function AppTabs() {
  return (
    <Tabs style={styles.shell}>
      <TabList asChild>
        <Sidebar>
          {primaryDestinations.map((destination) => (
            <TabTrigger key={destination.id} name={destination.id} href={destination.href} asChild>
              <TabButton icon={destination.id}>{destination.label}</TabButton>
            </TabTrigger>
          ))}
        </Sidebar>
      </TabList>
      <TabSlot style={styles.slot} />
    </Tabs>
  );
}

function TabButton({
  children,
  isFocused,
  icon,
  onPress,
  ...props
}: TabTriggerSlotProps & { icon: PrimaryDestinationId }) {
  const theme = useTheme();
  const { collapsed } = useContext(CollapsedContext);
  const color = isFocused ? theme.text : theme.textSecondary;

  return (
    <Pressable
      {...props}
      accessibilityLabel={typeof children === 'string' ? children : undefined}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(isFocused) }}
      onPress={onPress}
      style={({ pressed, hovered }: PressState) => [
        styles.link,
        collapsed && styles.linkCollapsed,
        {
          backgroundColor: isFocused || pressed || hovered ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <NavGlyph name={icon} color={color} />
      <ExpandedContent style={styles.linkCopy}>
        <ThemedText
          style={[styles.linkLabel, isFocused && styles.linkLabelActive]}
          themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ExpandedContent>
    </Pressable>
  );
}

function ExpandedContent({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const { collapsed, transitionDuration } = useContext(CollapsedContext);

  return (
    <View
      accessibilityElementsHidden={collapsed}
      style={[
        styles.expandedContent,
        style,
        transitionStyle(transitionDuration, 'opacity, max-width, transform'),
        {
          maxWidth: collapsed ? 0 : 240,
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transform: [{ translateX: collapsed ? -4 : 0 }],
        },
      ]}>
      {children}
    </View>
  );
}

function Sidebar(props: TabListProps) {
  const router = useRouter();
  const theme = useTheme();
  const { scheme, toggleTheme } = useThemeController();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const narrow = width < COLLAPSE_BREAKPOINT;
  const [userCollapsed, setUserCollapsed] = useState(false);
  const collapsed = narrow || userCollapsed;
  const switchingToDark = scheme === 'light';
  const sidebarBg = scheme === 'dark' ? theme.surfaceElevated : theme.backgroundElement;
  const desktopUpdate = useDesktopUpdate();
  const reportLessonActive = desktopUpdate?.setLessonActive;
  const { activeLessonId } = useLearning();
  const pathname = usePathname();
  const transitionDuration = sidebarTransitionDuration(reducedMotion);

  useEffect(() => {
    reportLessonActive?.(isVisibleLessonActive(activeLessonId, pathname));
    return () => reportLessonActive?.(false);
  }, [activeLessonId, pathname, reportLessonActive]);

  return (
    <CollapsedContext.Provider value={{ collapsed, transitionDuration }}>
      <View
        {...props}
        accessibilityRole="tablist"
        style={[
          styles.sidebar,
          transitionStyle(transitionDuration, 'width, padding-left, padding-right'),
          {
            backgroundColor: sidebarBg,
            borderRightColor: theme.border,
            paddingHorizontal: collapsed ? 4 : 8,
            width: collapsed ? COLLAPSED_RAIL_WIDTH : RAIL_WIDTH,
          },
        ]}>
        <View style={[styles.header, collapsed && styles.headerCollapsed]}>
          <Pressable
            accessibilityLabel="GlideLingo"
            accessibilityRole="button"
            onPress={() => {
              if (collapsed && !narrow) setUserCollapsed(false);
            }}
            style={({ pressed, hovered }: PressState) => [
              styles.brand,
              collapsed && styles.brandCollapsed,
              { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
            ]}>
            <GlideLingoBrandMark color={theme.text} size={32} />
            <ExpandedContent>
              <ThemedText style={styles.brandName}>GlideLingo</ThemedText>
            </ExpandedContent>
          </Pressable>

          <ExpandedContent>
            <Pressable
              accessibilityLabel="Close sidebar"
              accessibilityRole="button"
              onPress={() => setUserCollapsed(true)}
              style={({ pressed, hovered }: PressState) => [
                styles.iconButton,
                { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
              ]}>
              <PanelLeftIcon color={theme.textSecondary} />
            </Pressable>
          </ExpandedContent>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>
          {props.children}
        </ScrollView>

        <View style={styles.footer}>
          <ExpandedContent>
            <View style={styles.coursePicker}>
              <CoursePicker />
            </View>
          </ExpandedContent>
          <DesktopUpdateSidebarStatus collapsed={collapsed} />
          <Pressable
            accessibilityLabel="Profile and settings"
            accessibilityRole="button"
            onPress={() => router.push('/profile')}
            style={({ pressed, hovered }: PressState) => [
              styles.footerButton,
              collapsed && styles.footerButtonCollapsed,
              { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
            ]}>
            <ProfileIcon color={theme.textSecondary} />
            <ExpandedContent style={styles.footerCopy}>
              <ThemedText style={styles.footerLabel} themeColor="textSecondary">
                Profile and settings
              </ThemedText>
            </ExpandedContent>
          </Pressable>
          <Pressable
            accessibilityLabel={`Switch to ${switchingToDark ? 'dark' : 'light'} mode`}
            accessibilityRole="button"
            accessibilityState={{ selected: scheme === 'dark' }}
            onPress={toggleTheme}
            style={({ pressed, hovered }: PressState) => [
              styles.footerButton,
              collapsed && styles.footerButtonCollapsed,
              { backgroundColor: pressed || hovered ? theme.backgroundSelected : 'transparent' },
            ]}>
            {switchingToDark ? <MoonIcon color={theme.textSecondary} /> : <SunIcon color={theme.textSecondary} />}
            <ExpandedContent style={styles.footerCopy}>
              <ThemedText style={styles.footerLabel} themeColor="textSecondary">
                {switchingToDark ? 'Dark mode' : 'Light mode'}
              </ThemedText>
            </ExpandedContent>
          </Pressable>
        </View>
      </View>
    </CollapsedContext.Provider>
  );
}

function NavGlyph({
  name,
  color,
}: {
  name: PrimaryDestinationId;
  color: string;
}) {
  if (name === 'home') return <HouseIcon color={color} />;
  if (name === 'course') return <MapIcon color={color} />;
  if (name === 'speak') return <PhrasesIcon color={color} />;
  if (name === 'practice') return <ReviewIcon color={color} />;
  return <ChartIcon color={color} />;
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', height: '100%', width: '100%' },
  slot: { flex: 1, height: '100%' },
  sidebar: {
    borderRightWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    height: '100%',
    paddingBottom: 8,
    paddingTop: 12,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  headerCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  brand: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    cursor: 'pointer',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  brandCollapsed: {
    flexBasis: 44,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 0,
    width: 44,
  },
  brandName: {
    fontFamily: Fonts.sansSemibold,
    fontSize: 18,
    letterSpacing: -0.54,
    lineHeight: 20,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: Radii.small,
    cursor: 'pointer',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  nav: { flex: 1 },
  navContent: { gap: 2, paddingTop: 4 },
  link: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 8,
  },
  linkCollapsed: { height: 40, justifyContent: 'center', minHeight: 40, paddingHorizontal: 0, width: 44 },
  linkLabel: { flex: 1, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  linkCopy: { flex: 1 },
  linkLabelActive: { fontFamily: Fonts.sansMedium },
  footerButton: {
    alignItems: 'center',
    borderRadius: Radii.medium,
    cursor: 'pointer',
    flexDirection: 'row',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 8,
  },
  footerButtonCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  footerLabel: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  footerCopy: { flex: 1 },
  footer: { gap: 2 },
  coursePicker: { alignItems: 'stretch', paddingBottom: 4, paddingHorizontal: 4 },
  expandedContent: { overflow: 'hidden' },
});
