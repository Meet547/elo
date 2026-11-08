import * as React from "react";
const query = "(max-width: 767px)";
function subscribe(changed: () => void) {
  const screen = window.matchMedia(query);
  screen.addEventListener("change", changed);
  return () => screen.removeEventListener("change", changed);
}
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
