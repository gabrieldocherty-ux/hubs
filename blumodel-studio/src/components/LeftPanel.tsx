import { useDesignStore } from '../store/useDesignStore';
import { useCatalog } from '../store/useCatalog';
import { CatalogPanel } from './CatalogPanel';
import { RoomPanel } from './RoomPanel';

export function LeftPanel() {
  const tab = useDesignStore((s) => s.ui.leftTab);
  const setUI = useDesignStore((s) => s.setUI);
  const count = useCatalog((s) => s.products.length);
  return (
    <aside className="panel left-panel">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'on' : ''} onClick={() => setUI({ leftTab: 'products' })}>
          Products <span className="badge plain mono">{count}</span>
        </button>
        <button role="tab" aria-selected={tab === 'room'} className={tab === 'room' ? 'on' : ''} onClick={() => setUI({ leftTab: 'room' })}>
          Room & Finishes
        </button>
      </div>
      <div className="panel-body">{tab === 'products' ? <CatalogPanel /> : <div className="panel-scroll"><RoomPanel /></div>}</div>
    </aside>
  );
}
