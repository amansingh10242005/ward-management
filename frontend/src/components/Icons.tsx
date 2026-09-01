import React from 'react';

// ── Shared SVG wrapper ───────────────────────────────────────────────────────
const SVG = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  />
);

// ── Existing icons ──────────────────────────────────────────────────────────

export const IconSearch = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </SVG>
);

export const IconUser = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </SVG>
);

export const IconSettings = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </SVG>
);

export const IconPoint = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </SVG>
);

export const IconLine = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M3 21 21 3" />
    <circle cx="3" cy="21" r="2" fill="currentColor" />
    <circle cx="21" cy="3" r="2" fill="currentColor" />
  </SVG>
);

export const IconPolygon = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M3 21 12 3l9 18z" />
  </SVG>
);

export const IconEye = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </SVG>
);

export const IconEyeOff = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </SVG>
);

export const IconMore = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="19" r="1" />
  </SVG>
);

export const IconPlus = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <line x1="12" x2="12" y1="5" y2="19" />
    <line x1="5" x2="19" y1="12" y2="12" />
  </SVG>
);

export const IconMapPin = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </SVG>
);

export const IconStreetlight = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M12 2v20" />
    <path d="M8 2h8" />
    <path d="M15 2v4a3 3 0 0 1-3 3h0" />
    <circle cx="12" cy="10" r="1" fill="currentColor" />
  </SVG>
);

// ── New icons ───────────────────────────────────────────────────────────────

export const IconBell = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </SVG>
);

export const IconChevronDown = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="m6 9 6 6 6-6" />
  </SVG>
);

export const IconFullscreen = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </SVG>
);

export const IconShare = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" x2="12" y1="2" y2="15" />
  </SVG>
);

export const IconLayers = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </SVG>
);

export const IconSun = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </SVG>
);

export const IconMoon = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </SVG>
);

export const IconCompass = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <text x="12" y="8" fontSize="8" fontWeight="900" textAnchor="middle" fill="#ef4444" stroke="none" style={{ fontFamily: 'sans-serif' }}>N</text>
    <path d="M12 10 L18 22 L12 19 L6 22 Z" />
  </SVG>
);

export const IconZoomIn = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" x2="16.65" y1="21" y2="16.65" />
    <line x1="11" x2="11" y1="8" y2="14" />
    <line x1="8" x2="14" y1="11" y2="11" />
  </SVG>
);

export const IconZoomOut = (props: React.SVGProps<SVGSVGElement>) => (
  <SVG {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" x2="16.65" y1="21" y2="16.65" />
    <line x1="8" x2="14" y1="11" y2="11" />
  </SVG>
);
