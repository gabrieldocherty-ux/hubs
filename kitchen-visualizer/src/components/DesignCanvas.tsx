import { useRef } from 'react';
import type { DragEvent } from 'react';
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva';
import type Konva from 'konva';
import { useDesignStore } from '../store/useDesignStore';
import { CATALOG } from '../data/catalog';

const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 620;
const PADDING = 24;

function catalogItem(catalogId: string) {
  return CATALOG.find((c) => c.id === catalogId);
}

export function DesignCanvas() {
  const room = useDesignStore((s) => s.room);
  const items = useDesignStore((s) => s.items);
  const selectedInstanceId = useDesignStore((s) => s.selectedInstanceId);
  const addItem = useDesignStore((s) => s.addItem);
  const moveItem = useDesignStore((s) => s.moveItem);
  const selectItem = useDesignStore((s) => s.selectItem);

  const wrapperRef = useRef<HTMLDivElement>(null);

  const scale = Math.min(
    (STAGE_WIDTH - PADDING * 2) / room.widthIn,
    (STAGE_HEIGHT - PADDING * 2) / room.lengthIn
  );

  const roomPxWidth = room.widthIn * scale;
  const roomPxHeight = room.lengthIn * scale;

  function toInches(px: number, axisLenIn: number) {
    const inches = (px - PADDING) / scale;
    return Math.min(Math.max(inches, 0), axisLenIn);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const catalogId = e.dataTransfer.getData('text/plain');
    if (!catalogId || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const x = toInches(px, room.widthIn);
    const y = toInches(py, room.lengthIn);
    addItem(catalogId, x, y);
  }

  const gridLinesX: number[] = [];
  for (let ftMark = 12; ftMark < room.widthIn; ftMark += 12) gridLinesX.push(ftMark);
  const gridLinesY: number[] = [];
  for (let ftMark = 12; ftMark < room.lengthIn; ftMark += 12) gridLinesY.push(ftMark);

  return (
    <div
      className="canvas-wrapper"
      ref={wrapperRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Stage
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) selectItem(null);
        }}
      >
        <Layer>
          {/* Room floor */}
          <Rect
            x={PADDING}
            y={PADDING}
            width={roomPxWidth}
            height={roomPxHeight}
            fill="#faf8f4"
            stroke="#2b2b2b"
            strokeWidth={3}
          />

          {/* 1ft grid */}
          {gridLinesX.map((mark) => (
            <Line
              key={`gx-${mark}`}
              points={[PADDING + mark * scale, PADDING, PADDING + mark * scale, PADDING + roomPxHeight]}
              stroke="#e4ddce"
              strokeWidth={1}
            />
          ))}
          {gridLinesY.map((mark) => (
            <Line
              key={`gy-${mark}`}
              points={[PADDING, PADDING + mark * scale, PADDING + roomPxWidth, PADDING + mark * scale]}
              stroke="#e4ddce"
              strokeWidth={1}
            />
          ))}

          {/* Dimension labels */}
          <Text
            x={PADDING}
            y={PADDING + roomPxHeight + 6}
            text={`${(room.widthIn / 12).toFixed(1)} ft wide`}
            fontSize={13}
            fill="#5a5a5a"
          />
          <Text
            x={PADDING + roomPxWidth + 8}
            y={PADDING}
            text={`${(room.lengthIn / 12).toFixed(1)} ft`}
            fontSize={13}
            fill="#5a5a5a"
            rotation={90}
          />

          {items.map((placed) => {
            const item = catalogItem(placed.catalogId);
            if (!item) return null;
            const w = item.widthIn * scale;
            const h = item.depthIn * scale;
            const finish = item.finishes[placed.finishIndex] ?? item.finishes[0];
            const isSelected = placed.instanceId === selectedInstanceId;

            return (
              <Group
                key={placed.instanceId}
                x={PADDING + placed.x * scale}
                y={PADDING + placed.y * scale}
                rotation={placed.rotationDeg}
                draggable
                dragBoundFunc={(pos) => {
                  const minX = PADDING;
                  const maxX = PADDING + roomPxWidth;
                  const minY = PADDING;
                  const maxY = PADDING + roomPxHeight;
                  return {
                    x: Math.min(Math.max(pos.x, minX), maxX),
                    y: Math.min(Math.max(pos.y, minY), maxY),
                  };
                }}
                onClick={() => selectItem(placed.instanceId)}
                onTap={() => selectItem(placed.instanceId)}
                onDragEnd={(e: Konva.KonvaEventObject<globalThis.DragEvent>) => {
                  const node = e.target;
                  const x = toInches(node.x(), room.widthIn);
                  const y = toInches(node.y(), room.lengthIn);
                  moveItem(placed.instanceId, x, y);
                }}
              >
                <Rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  fill={finish.hex}
                  stroke={isSelected ? '#2563eb' : '#2b2b2b'}
                  strokeWidth={isSelected ? 3 : 1.5}
                  cornerRadius={2}
                />
                <Text
                  x={-w / 2}
                  y={-6}
                  width={w}
                  align="center"
                  text={item.name}
                  fontSize={11}
                  fill="#1a1a1a"
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
