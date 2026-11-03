// Conjunto único de ícones (traço fino, mesmo estilo em todo o app).
const P = {
  dots: '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  later: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  cancel: '<circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/>',
  notpaid: '<path d="M12 4v10"/><circle cx="12" cy="18.5" r=".8" fill="currentColor"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  select: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  money: '<path d="M12 4v16"/><path d="M16 8.5c0-1.7-1.8-2.5-4-2.5s-4 .9-4 2.8c0 3.9 8 2 8 6 0 2-1.8 3.2-4 3.2s-4-.9-4-2.7"/>',
  restore: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9"/><path d="M4 4v5h5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>',
  piggy: '<path d="M5 11a6 5 0 016-5h3a6 5 0 016 5v1l1.5 1-1.5 2v1.5h-2.5V19h-2.5v-1.5h-4V19H8.5v-2A5 5 0 015 12.5z"/><circle cx="15.5" cy="10.5" r=".7" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  history: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6.6 3.5"/><path d="M4 4v4h4M12 8v4l3 2"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>',
  transfer: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  install: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M12 8v6M9.5 11.5L12 14l2.5-2.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); });
}
