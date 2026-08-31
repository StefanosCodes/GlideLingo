import { createElement, type ReactNode } from 'react';

type SvgProps = {
  size: number;
  viewBox?: string;
  children: ReactNode;
};

function Svg({ size, viewBox = '0 0 24 24', children }: SvgProps) {
  return createElement(
    'svg',
    {
      'aria-hidden': true,
      fill: 'none',
      height: size,
      viewBox,
      width: size,
      xmlns: 'http://www.w3.org/2000/svg',
    },
    children,
  );
}

function Path(props: Record<string, string | number>) {
  return createElement('path', props);
}

function Rect(props: Record<string, string | number>) {
  return createElement('rect', props);
}

export function OpenFDEMark({ size = 22, color }: { size?: number; color: string }) {
  const stroke = {
    stroke: color,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 6,
  };

  return (
    <Svg size={size} viewBox="0 0 64 64">
      <Path d="M41 12H27C16.5 12 8 20.5 8 31v2c0 10.5 8.5 19 19 19h14" {...stroke} />
      <Path d="M29 22h25M29 32h18M29 42h25" {...stroke} />
    </Svg>
  );
}

export function PanelLeftIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Rect x="3.25" y="3.25" width="17.5" height="17.5" rx="2.2" stroke={color} strokeWidth="1.5" />
      <Path d="M9 3.5v17" stroke={color} strokeWidth="1.5" />
    </Svg>
  );
}

export function SunIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <Path
        d="M12 3.5v1.2M12 19.3v1.2M4.7 4.7l.85.85M18.45 18.45l.85.85M3.5 12h1.2M19.3 12h1.2M4.7 19.3l.85-.85M18.45 5.55l.85-.85"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function MoonIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M17.5 14.2A7.2 7.2 0 0 1 9.8 6.5 5.8 5.8 0 1 0 17.5 14.2Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function HouseIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M4.5 10.2 12 4.25l7.5 5.95V19a1.5 1.5 0 0 1-1.5 1.5h-4.25v-6.25h-3.5V20.5H6A1.5 1.5 0 0 1 4.5 19V10.2Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function MapIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M8.5 5.2 3.75 7.1v12.2l4.75-1.9 6.5 1.9 4.75-1.9V5.2L15 7.1 8.5 5.2Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <Path d="M8.5 5.2v12.2M15 7.1v12.2" stroke={color} strokeWidth="1.4" />
    </Svg>
  );
}

export function LettersIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Rect x="3.5" y="4" width="17" height="16" rx="2" stroke={color} strokeWidth="1.4" />
      <Path d="M8 16 12 8l4 8M9.5 13h5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PhrasesIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M5.5 5h13A2.5 2.5 0 0 1 21 7.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3h-1A2.5 2.5 0 0 1 3 14.5v-7A2.5 2.5 0 0 1 5.5 5Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <Path d="M7.5 9.25h9M7.5 12.75h6" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  );
}

export function ProfileIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke={color} strokeWidth="1.4" />
      <Path d="M4.5 20a7.5 5.5 0 0 1 15 0" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  );
}

export function ReviewIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path
        d="M20 12a8 8 0 1 1-2.3-5.6L20 8.5"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M20 4.5V8.5h-4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChartIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg size={size}>
      <Path d="M4 20V5.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <Path d="M4 20h16" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <Path d="M8.5 16v-4.5M12.5 16V8M16.5 16v-7" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronIcon({ size = 14, color, open }: { size?: number; color: string; open: boolean }) {
  return (
    <Svg size={size}>
      <Path
        d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
