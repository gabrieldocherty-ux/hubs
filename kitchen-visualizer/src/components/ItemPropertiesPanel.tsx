import { useDesignStore } from '../store/useDesignStore';
import { CATALOG } from '../data/catalog';

export function ItemPropertiesPanel() {
  const items = useDesignStore((s) => s.items);
  const selectedInstanceId = useDesignStore((s) => s.selectedInstanceId);
  const rotateItem = useDesignStore((s) => s.rotateItem);
  const removeItem = useDesignStore((s) => s.removeItem);
  const setFinish = useDesignStore((s) => s.setFinish);

  const placed = items.find((it) => it.instanceId === selectedInstanceId);
  const item = placed ? CATALOG.find((c) => c.id === placed.catalogId) : undefined;

  if (!placed || !item) {
    return (
      <aside className="properties-panel">
        <h2>Selected item</h2>
        <p className="hint">Click an item on the floor plan to edit it.</p>
      </aside>
    );
  }

  const finish = item.finishes[placed.finishIndex] ?? item.finishes[0];

  return (
    <aside className="properties-panel">
      <h2>Selected item</h2>
      <div className="properties-body">
        <div className="properties-name">{item.name}</div>
        <div className="properties-meta">{item.brand}</div>
        <div className="properties-meta">
          {item.widthIn}" × {item.depthIn}" · rotated {placed.rotationDeg}°
        </div>

        <div className="finish-label">Finish: {finish.name}</div>
        <div className="finish-swatches">
          {item.finishes.map((f, idx) => (
            <button
              key={f.name}
              className={`finish-swatch ${idx === placed.finishIndex ? 'active' : ''}`}
              style={{ background: f.hex }}
              title={f.name}
              onClick={() => setFinish(placed.instanceId, idx)}
            />
          ))}
        </div>

        <div className="properties-actions">
          <button onClick={() => rotateItem(placed.instanceId)}>Rotate 90°</button>
          <button className="danger" onClick={() => removeItem(placed.instanceId)}>
            Remove
          </button>
        </div>
      </div>
    </aside>
  );
}
