import * as React from "react";

/**
 * Subscribes to a CSS media query. Re-renders when the result flips.
 *
 * Mirrored from the layout's mobile breakpoint (768px) so JavaScript-side
 * conditionals stay in sync with CSS — components that need to swap entire
 * structural elements (drawer ↔ bottom sheet, full-screen modal ↔ centered)
 * read the same boolean the stylesheet reasons about.
 */
export function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches;

  const [matches, setMatches] = React.useState(get);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Convenience wrapper used across the app — keep the breakpoint in one place. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 768px)");
}
