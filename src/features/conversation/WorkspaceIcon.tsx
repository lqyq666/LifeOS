type Name = 'panel' | 'compose' | 'search' | 'folder' | 'plus' | 'chevron' | 'more' | 'pin' | 'mic' | 'stop' | 'orbit' | 'send' | 'close' | 'check' | 'arrow'
const paths: Record<Name, string> = {
  panel: 'M8 4v16M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
  compose: 'M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7M16 3l5 5M11 13l-1 4 4-1 7-7a2.8 2.8 0 0 0-4-4Z',
  search: 'M16 16l5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  plus: 'M12 5v14M5 12h14', chevron: 'm9 5 7 7-7 7', more: 'M5 12h.01M12 12h.01M19 12h.01',
  pin: 'm9 3 6 0-1 7 4 4H6l4-4ZM12 14v7',
  mic: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M9 22h6',
  stop: 'M7 7h10v10H7Z', orbit: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM21 8c1 3-2 7-7 9S4 18 3 15s2-7 7-9 10-1 11 2Z',
  send: 'M12 19V5m-6 6 6-6 6 6',
  close: 'm6 6 12 12M18 6 6 18', check: 'm5 12 4 4 10-10', arrow: 'M5 19 19 5M7 5h12v12',
}
export function WorkspaceIcon({ name, size = 18 }: { name: Name; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={paths[name]} stroke="currentColor" strokeWidth={name === 'more' ? 3.5 : 1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
}
