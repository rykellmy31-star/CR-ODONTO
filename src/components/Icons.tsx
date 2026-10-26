// Ícones em SVG inline (traço), sem dependência de fonte de emoji.
// Motivo: emojis dependem de fontes do sistema e podem aparecer como quadrados
// em servidores/desktops sem Noto Color Emoji. SVG sempre renderiza igual.
export type IconName =
  | "home" | "calendar" | "patients" | "team" | "tooth" | "chat" | "chart"
  | "settings" | "building" | "tag" | "search" | "menu" | "close" | "logout"
  | "check" | "lock" | "clock" | "clipboard" | "link" | "chevron-left" | "chevron-right";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V21h13V9.5",
  calendar: "M7 3v3M17 3v3M4 8h16M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v13A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z",
  patients: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 21a7.5 7.5 0 0 1 15 0",
  team: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3 3 0 0 1 0 6M18 20a5.5 5.5 0 0 0-3-4.9",
  tooth: "M12 3c2.2 0 3 1 4.5 1S20 3.6 20 6.5c0 2-.6 3.2-1 5.5-.3 1.8-.4 3.4-.8 5.6-.3 1.6-1 2.4-2 2.4-1.2 0-1.5-1.4-1.7-3-.2-1.4-.5-2.6-1.5-2.6s-1.3 1.2-1.5 2.6c-.2 1.6-.5 3-1.7 3-1 0-1.7-.8-2-2.4-.4-2.2-.5-3.8-.8-5.6C6.6 9.7 6 8.5 6 6.5C6 3.6 7.5 4 9 4s1.8-1 3-1Z",
  chat: "M20 15.5A2.5 2.5 0 0 1 17.5 18H9l-5 3V5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5z",
  chart: "M4 20V4M4 20h16M8 16V11M12 16V7M16 16v-3",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.3M17.6 15.2l2.2 1.3M4.2 16.5l2.2-1.3M17.6 8.8l2.2-1.3",
  building: "M4 21V6.5A1.5 1.5 0 0 1 5.5 5H13a1.5 1.5 0 0 1 1.5 1.5V21M14.5 10H19a1 1 0 0 1 1 1v10M3 21h18M7.5 9h3M7.5 13h3M7.5 17h3",
  tag: "M20 12.5 12.5 20a2 2 0 0 1-2.8 0L4 14.3V4h10.3l5.7 5.7a2 2 0 0 1 0 2.8ZM8 8h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.5 16.5 21 21",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6 6 18",
  logout: "M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h9",
  check: "M4.5 12.5 9.5 17.5 19.5 6.5",
  lock: "M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13A1.5 1.5 0 0 1 20 11.5v8A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3.5 2",
  clipboard: "M9 4.5h6M8 6.5H6.5A1.5 1.5 0 0 0 5 8v11.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8a1.5 1.5 0 0 0-1.5-1.5H16M9 4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5v1a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 5.5zM8.5 11h7M8.5 15h5",
  "chevron-left": "M14.5 5.5 8 12l6.5 6.5",
  "chevron-right": "M9.5 5.5 16 12l-6.5 6.5",
  link: "M10 13a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 11a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1",
};

export function Icon({
  name, className = "h-[18px] w-[18px]", strokeWidth = 1.8,
}: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
