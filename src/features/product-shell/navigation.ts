export const primaryDestinations = [
  {
    id: 'home',
    label: 'Home',
    route: 'index',
    href: '/',
    nativeIcon: { android: 'home', ios: { default: 'house', selected: 'house.fill' } },
  },
  {
    id: 'course',
    label: 'Course',
    route: 'course',
    href: '/course',
    nativeIcon: { android: 'map', ios: { default: 'map', selected: 'map.fill' } },
  },
  {
    id: 'speak',
    label: 'Speak',
    route: 'speak',
    href: '/speak',
    nativeIcon: { android: 'mic', ios: { default: 'mic', selected: 'mic.fill' } },
  },
  {
    id: 'practice',
    label: 'Practice',
    route: 'practice',
    href: '/practice',
    nativeIcon: { android: 'refresh', ios: { default: 'arrow.clockwise', selected: 'arrow.clockwise.circle.fill' } },
  },
  {
    id: 'progress',
    label: 'Progress',
    route: 'progress',
    href: '/progress',
    nativeIcon: { android: 'bar_chart', ios: { default: 'chart.bar', selected: 'chart.bar.fill' } },
  },
] as const;

export type PrimaryDestinationId = (typeof primaryDestinations)[number]['id'];
