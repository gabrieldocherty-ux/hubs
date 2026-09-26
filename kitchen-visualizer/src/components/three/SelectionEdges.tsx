import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

const ACCENT = '#c2542d';
const BAD = '#d8412f';

/** A crisp outline box around the selected piece; red when it has a problem. */
export function SelectionEdges({ w, d, y0, h, z = 0, problem }: { w: number; d: number; y0: number; h: number; z?: number; problem?: boolean }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 1, h + 1, d + 1)), [w, h, d]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: problem ? BAD : ACCENT, depthTest: false, transparent: true, opacity: 0.95 }), [problem]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <lineSegments geometry={geo} material={mat} position={[0, y0 + h / 2, z]} renderOrder={10} />;
}
