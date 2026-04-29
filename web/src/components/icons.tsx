// Lucide-style icon set. 1.6px stroke. Currentcolor.
// Original: prototype/icons.jsx — converted to ES module exports.

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

const baseProps = (props: IconProps): React.SVGProps<SVGSVGElement> => ({
  width: props.size || 16,
  height: props.size || 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  ...props,
});

export const IconLock = (p: IconProps) => <svg {...baseProps(p)}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
export const IconShieldCheck = (p: IconProps) => <svg {...baseProps(p)}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>;
export const IconKey = (p: IconProps) => <svg {...baseProps(p)}><circle cx="8" cy="14" r="3"/><path d="m10 12 8-8m-3 3 2 2m-5 0 2 2"/></svg>;
export const IconClock = (p: IconProps) => <svg {...baseProps(p)}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
export const IconFlame = (p: IconProps) => <svg {...baseProps(p)}><path d="M8.5 14a3.5 3.5 0 0 0 7 0c0-1.5-1-2.7-2-3.5-1-1-1.5-2-1-4-2 .5-3.5 2-4 4-.5 1.4-.2 2.5 0 3.5z"/><path d="M12 21a8 8 0 0 0 8-8c0-3-1.5-5-3.5-7-.5 2-2 3-3.5 3.5 0-2-1-3.5-2-5-1 2-3 3-4.5 5C5 11 4 13 4 15a8 8 0 0 0 8 6z" opacity="0.5"/></svg>;
export const IconCopy = (p: IconProps) => <svg {...baseProps(p)}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>;
export const IconCheck = (p: IconProps) => <svg {...baseProps(p)}><path d="m5 12 5 5L20 7"/></svg>;
export const IconCheckCircle = (p: IconProps) => <svg {...baseProps(p)}><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>;
export const IconX = (p: IconProps) => <svg {...baseProps(p)}><path d="M18 6 6 18M6 6l12 12"/></svg>;
export const IconChevron = (p: IconProps) => <svg {...baseProps(p)}><path d="m6 9 6 6 6-6"/></svg>;
export const IconChevronRight = (p: IconProps) => <svg {...baseProps(p)}><path d="m9 6 6 6-6 6"/></svg>;
export const IconChevronDown = (p: IconProps) => <svg {...baseProps(p)}><path d="m6 9 6 6 6-6"/></svg>;
export const IconChevronLeft = (p: IconProps) => <svg {...baseProps(p)}><path d="m15 18-6-6 6-6"/></svg>;
export const IconSearch = (p: IconProps) => <svg {...baseProps(p)}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>;
export const IconSettings = (p: IconProps) => <svg {...baseProps(p)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
export const IconBook = (p: IconProps) => <svg {...baseProps(p)}><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5a2.5 2.5 0 0 0 0 5H20"/></svg>;
export const IconGithub = (p: IconProps) => <svg {...baseProps(p)}><path d="M9 19c-4 1.5-4-2-6-2.5M15 22v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.6 0-1.3-.5-2.6-1.4-3.5.4-1.2.4-2.5-.1-3.6 0 0-1.1-.4-3.7 1.4a12.5 12.5 0 0 0-6.5 0C5.9.5 4.8.9 4.8.9c-.5 1.1-.5 2.4-.1 3.6A5 5 0 0 0 3.4 8c0 5 3 6.3 6 6.6-.4.4-.7.9-.8 1.5-.2.6-.2 1.1-.1 1.7v3.6"/></svg>;
export const IconSun = (p: IconProps) => <svg {...baseProps(p)}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5"/></svg>;
export const IconMoon = (p: IconProps) => <svg {...baseProps(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>;
export const IconPaperclip = (p: IconProps) => <svg {...baseProps(p)}><path d="m21 12-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8.5-8.5"/></svg>;
export const IconCornerDownLeft = (p: IconProps) => <svg {...baseProps(p)}><path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>;
export const IconQr = (p: IconProps) => <svg {...baseProps(p)}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v0M14 21h3M21 17v4"/></svg>;
export const IconExternal = (p: IconProps) => <svg {...baseProps(p)}><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>;
export const IconAlert = (p: IconProps) => <svg {...baseProps(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>;
export const IconReply = (p: IconProps) => <svg {...baseProps(p)}><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>;
export const IconTrash = (p: IconProps) => <svg {...baseProps(p)}><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
export const IconPlus = (p: IconProps) => <svg {...baseProps(p)}><path d="M12 5v14M5 12h14"/></svg>;
export const IconRefresh = (p: IconProps) => <svg {...baseProps(p)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/></svg>;
export const IconHash = (p: IconProps) => <svg {...baseProps(p)}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>;
export const IconKeyboard = (p: IconProps) => <svg {...baseProps(p)}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M10 14h4"/></svg>;
export const IconFile = (p: IconProps) => <svg {...baseProps(p)}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
export const IconUpload = (p: IconProps) => <svg {...baseProps(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><path d="M12 3v12"/></svg>;
export const IconDownload = (p: IconProps) => <svg {...baseProps(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/></svg>;
export const IconEye = (p: IconProps) => <svg {...baseProps(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>;
export const IconEyeOff = (p: IconProps) => <svg {...baseProps(p)}><path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 7 10 7a14 14 0 0 1-2.4 3.5"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/><path d="M17.4 17.4A10 10 0 0 1 12 19C5.5 19 2 12 2 12a14 14 0 0 1 4.6-5.6"/><path d="m1 1 22 22"/></svg>;
export const IconCode = (p: IconProps) => <svg {...baseProps(p)}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
export const IconText = (p: IconProps) => <svg {...baseProps(p)}><path d="M4 7V5h16v2M9 5v14M9 19h6"/></svg>;
export const IconMd = (p: IconProps) => <svg {...baseProps(p)}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 15V9l3 3 3-3v6M16 9v6m0 0-2-2m2 2 2-2"/></svg>;
export const IconMessage = (p: IconProps) => <svg {...baseProps(p)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
export const IconMore = (p: IconProps) => <svg {...baseProps(p)}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>;
export const IconShare = (p: IconProps) => <svg {...baseProps(p)}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>;
export const IconShieldHalf = (p: IconProps) => <svg {...baseProps(p)}><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6l8-3z"/><path d="M12 3v18"/></svg>;
export const IconBolt = (p: IconProps) => <svg {...baseProps(p)}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>;
export const IconMaximize = (p: IconProps) => <svg {...baseProps(p)}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>;
export const IconMinimize = (p: IconProps) => <svg {...baseProps(p)}><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>;
