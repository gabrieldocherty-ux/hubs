import { useEffect, useState } from 'react';
import { api, type Project } from '../../lib/api';
import { navigate, navigateHash } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { initialDoc, loadLocalDraft, saveLocalDraft, useDesignStore } from '../../store/useDesignStore';
import { timeAgo, useSession } from '../../store/useSession';
import { Close } from '../../components/Icons';
import type { Product } from '../../types';
import './brands.css';

/**
 * "Try in my kitchen" (BRAND_PAGE §5): signed-in homeowners pick one of their kitchens and the
 * product is placed there (`#/k/:id?add=`); anyone can drop it into the planner on this device.
 */
export default function TryInKitchen({ product, onClose }: { product: Product; onClose: () => void }) {
  const user = useSession((s) => s.user);
  const [kitchens, setKitchens] = useState<Pick<Project, 'id' | 'name' | 'client' | 'updatedAt'>[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    api
      .listProjects()
      .then((r) => live && setKitchens(r.projects.map((p) => ({ id: p.id, name: p.name, client: p.client, updatedAt: p.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => live && setKitchens([]));
    return () => {
      live = false;
    };
  }, [user]);

  const toKitchen = (id: string) => {
    useCatalog.getState().register([product]);
    navigate({ name: 'kitchen', id, add: product.id });
  };

  /** The device planner keeps its design in this browser: add the product to it, then open it. */
  const toDevice = () => {
    useCatalog.getState().register([product]);
    const store = useDesignStore.getState();
    store.loadDoc(loadLocalDraft() ?? initialDoc());
    const placed = store.addItem(product.id);
    saveLocalDraft(useDesignStore.getState().doc);
    navigateHash('#/local');
    if (placed) setTimeout(() => useDesignStore.getState().toast(`Added ${product.name}. Drag it into place on the plan.`, 'ok'), 300);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal try-modal" role="dialog" aria-modal="true" aria-labelledby="try-title">
        <header>
          <h3 id="try-title">Try it in a kitchen</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <p className="dialog-copy">
          Mise places the <b>{product.name}</b> in the kitchen you pick, at its real size. Drag it into place on the plan.
        </p>
        {user ? (
          kitchens === null ? (
            <p className="muted">Loading your kitchens…</p>
          ) : kitchens.length === 0 ? (
            <p className="muted">You have no saved kitchens yet.</p>
          ) : (
            <ul className="try-list">
              {kitchens.slice(0, 8).map((k) => (
                <li key={k.id}>
                  <button className="try-item" onClick={() => toKitchen(k.id)}>
                    <b>{k.name}</b>
                    <span>
                      {k.client ? `${k.client} · ` : ''}edited {timeAgo(k.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="muted">
            <a href={`#/signin?next=${encodeURIComponent(window.location.hash || '#/')}`}>Sign in</a> to add it to a saved kitchen.
          </p>
        )}
        <div className="modal-actions try-actions">
          {user && (
            <a className="btn" href="#/new">
              Start a new kitchen
            </a>
          )}
          <button className={user ? 'btn' : 'btn primary'} onClick={toDevice}>
            Open in the planner on this device
          </button>
        </div>
      </div>
    </div>
  );
}
