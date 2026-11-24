import React from "react";

type P = { size?: number; className?: string; title?: string };

const svg = (path: React.ReactNode, fill = false) =>
  function Icon({ size = 20, className, title }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill ? "currentColor" : "none"}
        stroke={fill ? "none" : "currentColor"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
      >
        {title && <title>{title}</title>}
        {path}
      </svg>
    );
  };

export const PlayIcon = svg(<path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />, true);
export const PauseIcon = svg(
  <>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
  </>,
  true,
);
export const NextIcon = svg(
  <>
    <path d="M5 5.5v13a.8.8 0 0 0 1.2.7l10-6.5a.8.8 0 0 0 0-1.4l-10-6.5A.8.8 0 0 0 5 5.5z" />
    <rect x="17.5" y="5" width="2.5" height="14" rx="1" />
  </>,
  true,
);
export const PrevIcon = svg(
  <>
    <path d="M19 5.5v13a.8.8 0 0 1-1.2.7l-10-6.5a.8.8 0 0 1 0-1.4l10-6.5a.8.8 0 0 1 1.2.7z" />
    <rect x="4" y="5" width="2.5" height="14" rx="1" />
  </>,
  true,
);
export const ShuffleIcon = svg(
  <>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="m4 4 5 5" />
  </>,
);
export const RepeatIcon = svg(
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>,
);
export const RepeatOneIcon = svg(
  <>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </>,
);
export const HeartIcon = svg(
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
);
export const HeartFillIcon = svg(
  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />,
  true,
);
export const VolumeIcon = svg(
  <>
    <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
    <path d="M16 9a5 5 0 0 1 0 6" />
    <path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
  </>,
);
export const MuteIcon = svg(
  <>
    <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
    <path d="m22 9-6 6" />
    <path d="m16 9 6 6" />
  </>,
);
export const QueueIcon = svg(
  <>
    <path d="M3 6h13" />
    <path d="M3 12h9" />
    <path d="M3 18h9" />
    <path d="M16 12v8" />
    <circle cx="18" cy="18" r="2" />
    <path d="M16 12h4" />
  </>,
);
export const SearchIcon = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const HomeIcon = svg(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </>,
);
export const LibraryIcon = svg(
  <>
    <path d="m16 6 4 14" />
    <path d="M12 6v14" />
    <path d="M8 8v12" />
    <path d="M4 4v16" />
  </>,
);
export const MoreIcon = svg(
  <>
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="12" cy="19" r="1.6" />
  </>,
  true,
);
export const ChevronDownIcon = svg(<path d="m6 9 6 6 6-6" />);
export const CloseIcon = svg(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
export const UploadIcon = svg(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </>,
);
export const MoonIcon = svg(<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />);
export const SignalIcon = svg(
  <>
    <path d="M2 20h.01" />
    <path d="M7 20v-4" />
    <path d="M12 20v-8" />
    <path d="M17 20V8" />
    <path d="M22 4v16" />
  </>,
);
export const MusicIcon = svg(
  <>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </>,
);
export const LyricsIcon = svg(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h7" />
  </>,
);
export const WifiOffIcon = svg(
  <>
    <path d="M12 20h.01" />
    <path d="M8.5 16.4a5 5 0 0 1 7 0" />
    <path d="M2 8.8a15 15 0 0 1 4.2-2.6" />
    <path d="M10.7 5.1A15 15 0 0 1 22 8.8" />
    <path d="M5 12.9a10 10 0 0 1 5.2-2.8" />
    <path d="M16.3 10.7a10 10 0 0 1 2.7 2.2" />
    <path d="m2 2 20 20" />
  </>,
);
