import * as THREE from 'three';
import { Box, Cyl } from './parts';
import { cached } from './materials';
import type { ModelProps } from './models';

/**
 * Outlets and switches: a cover plate on the wall face with the device in it. Same frame as every
 * other model (x across, y up from the floor, z from the wall at -d/2 to the face at +d/2).
 * Decora-style devices: a rectangular opening, two slots-and-ground faces for an outlet, a test
 * and reset pair on a GFCI, two USB ports, a rocker for a switch, a slider beside it for a dimmer.
 */

const plateMat = (hex: string, metal: boolean) =>
  cached(`plate:${hex}:${metal}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: metal ? 0.32 : 0.42, metalness: metal ? 0.8 : 0 }));
const slotMat = () => cached('device-slot', () => new THREE.MeshStandardMaterial({ color: '#2a2a2a', roughness: 0.8 }));

export function OutletModel({ r, finish }: ModelProps) {
  const { w, d, product } = r;
  const h = product.heightIn;
  const y = product.elevationIn + h / 2;
  const metal = finish.material === 'metal';
  const plate = plateMat(finish.hex, metal);
  // The device face is always the device's own colour; a metal plate pairs with a white or black device.
  const device = plateMat(metal ? '#f4f2ee' : finish.hex, false);
  const face = d / 2;
  const dw = Math.min(w - 1, 1.3);
  const dh = h - 1.6;
  const v = product.variant;
  const slots = (cy: number, k: string) => [
    <Box key={`${k}a`} size={[0.08, 0.28, 0.06]} pos={[-0.22, cy + 0.1, face + 0.13]} mat={slotMat()} cast={false} />,
    <Box key={`${k}b`} size={[0.08, 0.36, 0.06]} pos={[0.22, cy + 0.1, face + 0.13]} mat={slotMat()} cast={false} />,
    <Cyl key={`${k}g`} r={0.09} h={0.06} pos={[0, cy - 0.22, face + 0.13]} rot={[Math.PI / 2, 0, 0]} mat={slotMat()} seg={10} cast={false} />,
  ];
  return (
    <group>
      <Box size={[w, h, 0.18]} pos={[0, y, face - 0.09]} mat={plate} cast={false} />
      <Box size={[dw, dh, 0.12]} pos={[0, y, face + 0.06]} mat={device} cast={false} />
      {(v === 'duplex' || v === 'low') && [...slots(y + 0.85, 'u'), ...slots(y - 0.85, 'l')]}
      {v === 'gfci' && [
        ...slots(y + 1.1, 'u'),
        ...slots(y - 1.1, 'l'),
        <Box key="test" size={[0.5, 0.22, 0.08]} pos={[-0.3, y, face + 0.14]} mat={slotMat()} cast={false} />,
        <Box key="reset" size={[0.5, 0.22, 0.08]} pos={[0.3, y, face + 0.14]} mat={plateMat('#c9483b', false)} cast={false} />,
      ]}
      {v === 'usb' && [
        ...slots(y + 0.95, 'u'),
        <Box key="c" size={[0.34, 0.12, 0.06]} pos={[-0.25, y - 0.8, face + 0.13]} mat={slotMat()} cast={false} />,
        <Box key="a" size={[0.48, 0.18, 0.06]} pos={[0.25, y - 0.8, face + 0.13]} mat={slotMat()} cast={false} />,
      ]}
      {(v === 'switch' || v === 'dimmer') && <Box size={[dw - (v === 'dimmer' ? 0.35 : 0.12), dh - 0.2, 0.1]} pos={[v === 'dimmer' ? -0.15 : 0, y, face + 0.15]} mat={device} cast={false} />}
      {v === 'dimmer' && <Box size={[0.12, dh - 0.6, 0.08]} pos={[dw / 2 - 0.12, y, face + 0.14]} mat={slotMat()} cast={false} />}
    </group>
  );
}
