import { useEffect } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { usePlacement } from '../lib/interaction';
import { isCompact, useMobileUI } from '../components/MobileState';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const s = useDesignStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const id = s.selectedId;
      const key = e.key.toLowerCase();

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && key === 'd' && id) {
        e.preventDefault();
        s.duplicate(id);
        return;
      }
      if (mod) return;

      if (e.key === '/') {
        e.preventDefault();
        s.setUI({ leftTab: 'products' });
        if (isCompact()) useMobileUI.getState().openSheet('catalog');
        requestAnimationFrame(() => document.getElementById('catalog-search')?.focus());
        return;
      }
      if (e.key === '1') return s.setUI({ viewMode: 'plan' });
      if (e.key === '2') return s.setUI({ viewMode: 'split' });
      if (e.key === '3') return s.setUI({ viewMode: '3d' });
      if (e.key === '4') return s.setUI({ viewMode: 'walls' });
      if (e.key === 'Escape') {
        // One thing at a time: a product waiting to be placed, then an open sheet, then the selection.
        if (usePlacement.getState().armedProductId) return usePlacement.getState().disarm();
        if (useMobileUI.getState().sheet) return useMobileUI.getState().closeSheet();
        return s.select(null);
      }
      if (!id) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.remove(id);
      } else if (key === 'r') {
        s.rotate(id, e.shiftKey ? -1 : 1);
      } else if (key === 'f') {
        s.toggleMirror(id);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 6 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        s.nudge(id, dx, dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
