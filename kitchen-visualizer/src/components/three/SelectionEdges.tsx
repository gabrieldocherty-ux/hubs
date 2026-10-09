import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

const ACCENT = '#c2542d';
const BAD = '#d8412f';

// Two shared materials for the life of the page. A material per selection was disposed on every
// selection change, which released its shader program and compiled a new one each time a piece
// was selected or added (BUILD_PLAN A-T3: adding a pendant compiles no programs).
const lineMat = (color: string) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
let mats: { ok: THREE.LineBasicMaterial; bad: THREE.LineBasicMaterial } | null = null;
const shared = () => (mats ??= { ok: lineMat(ACCENT), bad: lineMat(BAD) });

/** A crisp outline box around the selected piece; red when it has a problem. */
export function SelectionEdges({ w, d, y0, h, z = 0, problem }: { w: number; d: number; y0: number; h: number; z?: number; problem?: boolean }) {
  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(w + 1, h + 1, d + 1);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [w, h, d]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = problem ? shared().bad : shared().ok;
  return <lineSegments geometry={geo} material={mat} position={[0, y0 + h / 2, z]} renderOrder={10} />;
}
