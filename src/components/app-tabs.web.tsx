import { createContext, useContext, useState } from 'react';
import { Tabs, TabList, TabTrigger, TabSlot, type TabListProps, type TabTriggerSlotProps } from 'expo-router/ui';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ModuleTree } from './module-tree';
import { ThemedText } from './themed-text';
import {
  ChartIcon,
  ChevronIcon,
  HouseIcon,
  MapIcon,
  MoonIcon,
  OpenFDEMark,
  PanelLeftIcon,
  ReviewIcon,
  SunIcon,
} from './ui/hackathon-icons.web';

import { Fonts, Radii } from '@/constants/theme';
import { useTheme, useThemeController } from '@/hooks/use-theme';
import { useLearning } from '@/providers/learning-provider';

const RAIL_WIDTH = 288;
const COLLAPSED_RAIL_WIDTH = 52;
const COLLAPSE_BREAKPOINT = 760;

type PressState = { pressed: boolean; hovered?: boolean };

const CollapsedContext = createContext(false);

export default function AppTabs() {
  return (
    <Tabs style={styles.shell}>
      <TabList asChild>
        <Sidebar>
          <TabTrigger name="home" href="/" asChild>
            <TabButton icon="today">Today</TabButton>
          </TabTrigger>
          <PathNav />
          <TabTrigger name="path" href="/path" asChild>
            <TabButton hidden icon="path">
              Path
            </TabButton>
          </TabTrigger>
          <TabTrigger name="review" href="/review" asChild>
            <TabButton icon="review">Review</TabButton>
          </TabTrigger>
          <TabTrigger name="progress" href="/progress" asChild>
            <TabButton icon="progress">Progress</TabButton>
          </TabTrigger>
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
  hidden,
  onPress,
  ...props
}: TabTriggerSlotProps & { icon: 'today' | 'path' | 'review' | 'progress'; hidden?: boolean }) {
  const theme = useTheme();
  const collapsed = useContext(CollapsedContext);
  const { focusModule, openLesson } = useLearning();
  const color = isFocused ? theme.text : theme.textSecondary;

  if (hidden) {
    return (
      <Pressable
        {...props}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onPress}
        style={styles.hiddenTab}
      />
    );
  }

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: Boolean(isFocused) }}
      onPress={(event) => {
        if (icon === 'today') {
          focusModule(null);
          openLesson(null);
        }
        onPress?.(event);
      }}
      style={({ pressed, hovered }: PressState) => [
        styles.link,
        collapsed && styles.linkCollapsed,
        {
          backgroundColor: isFocused || pressed || hovered ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <NavGlyph name={icon} color={color} />
      {!collapsed && (
        <ThemedText
          style={[styles.linkLabel, isFocused && styles.linkLabelActive]}
          themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      )}
    </Pressable>
  );
}

function PathNav() {
  const theme = useTheme();
  const router = useRouter();
  const collapsed = useContext(CollapsedContext);
  const { language, enrolledCourse, focusedModuleId, activeLessonId, focusModule, openLesson } = useLearning();
  const [open, setOpen] = useState(true);
  const courseLabel = enrolledCourse?.title ?? `${language.name} course`;
  const showTree = Boolean(enrolledCourse) && open && !collapsed;
  const color = showTree ? theme.text : theme.textSecondary;

  return (
    <View>
      <Pressable
        accessibilityLabel={
          enrolledCourse ? `${courseLabel}. ${open ? 'Collapse' : 'Expand'} modules` : courseLabel
        }
        accessibilityRole="button"
        accessibilityState={{ expanded: showTree }}
        onPress={() => {
          if (enrolledCourse && !collapsed) {
            setOpen((current) => !current);
            return;
          }
          router.push('/');
        }}
        style={({ pressed, hovered }: PressState) => [
          styles.link,
          collapsed && styles.linkCollapsed,
          { backgroundColor: showTree || pressed || hovered ? theme.backgroundSelected : 'transparent' },
        ]}>
        <MapIcon color={color} />
        {!collapsed && (
          <ThemedText
            numberOfLines={1}
            style={[styles.linkLabel, showTree && styles.linkLabelActive]}
            themeColor={showTree ? 'text' : 'textSecondary'}>
            {courseLabel}
          </ThemedText>
        )}
        {!collapsed && enrolledCourse ? <ChevronIcon color={theme.textTertiary} open={open} /> : null}
      </Pressable>
      {showTree ? (
        <View style={styles.pathTree}>
          <ModuleTree
            density="rail"
            selectedModuleId={focusedModuleId}
            selectedLessonId={activeLessonId}
            onSelectModule={(moduleId) => {
              focusModule(moduleId);
              router.push('/');
            }}
            onSelectLesson={(lessonId) => {
              openLesson(lessonId);
              router.push('/');
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function Sidebar(props: TabListProps) {
  const theme = useTheme();
  const { scheme, toggleTheme } = useThemeController();
  const { width } = useWindowDimensions();
  const narrow = width < COLLAPSE_BREAKPOINT;
  const [userCollapsed, setUserCollapsed] = useState(false);
  const collapsed = narrow || userCollapsed;
  const switchingToDark = scheme === 'light';
  const sidebarBg = scheme === 'dark' ? theme.surfaceElevated : theme.backgroundElement;

  return (
    <CollapsedContext.Provider value={collapsed}>
      <View
        {...props}
        accessibilityRole="tablist"
        style={[
          styles.sidebar,
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
            <View style={styles.brandMark}>
              <OpenFDEMark color={theme.text} size={22} />
            </View>
            {!collapsed && <ThemedText style={styles.brandName}>GlideLingo</ThemedText>}
          </Pressable>

          {!collapsed && (
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
          )}
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.nav} contentContainerStyle={styles.navContent}>
          {props.children}
        </ScrollView>

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
          {!collapsed && (
            <ThemedText style={styles.footerLabel} themeColor="textSecondary">
              {switchingToDark ? 'Dark mode' : 'Light mode'}
            </ThemedText>
          )}
        </Pressable>
      </View>
    </CollapsedContext.Provider>
  );
}

function NavGlyph({
  name,
  color,
}: {
  name: 'today' | 'path' | 'review' | 'progress';
  color: string;
}) {
  if (name === 'today') return <HouseIcon color={color} />;
  if (name === 'path') return <MapIcon color={color} />;
  if (name === 'review') return <ReviewIcon color={color} />;
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
    flex: 0,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 0,
    width: 44,
  },
  brandMark: { height: 22, width: 22 },
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
  pathTree: { paddingLeft: 6, paddingTop: 4 },
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
  hiddenTab: { height: 0, overflow: 'hidden', position: 'absolute', width: 0 },
});
