import { useState } from 'react';
import { useDesignStore } from '../store/useDesignStore';

function inchesToFeetIn(totalIn: number): { feet: number; inches: number } {
  const feet = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - feet * 12);
  return { feet, inches };
}

export function RoomSetup() {
  const room = useDesignStore((s) => s.room);
  const setRoom = useDesignStore((s) => s.setRoom);
  const clearAll = useDesignStore((s) => s.clearAll);

  const widthParts = inchesToFeetIn(room.widthIn);
  const lengthParts = inchesToFeetIn(room.lengthIn);

  const [width, setWidth] = useState(widthParts);
  const [length, setLength] = useState(lengthParts);

  function apply() {
    const widthIn = Math.max(60, width.feet * 12 + width.inches);
    const lengthIn = Math.max(60, length.feet * 12 + length.inches);
    setRoom({ widthIn, lengthIn });
  }

  return (
    <div className="room-setup">
      <div className="room-setup-fields">
        <label>
          Room width
          <div className="feet-in-input">
            <input
              type="number"
              min={0}
              value={width.feet}
              onChange={(e) => setWidth({ ...width, feet: Number(e.target.value) })}
            />
            <span>ft</span>
            <input
              type="number"
              min={0}
              max={11}
              value={width.inches}
              onChange={(e) => setWidth({ ...width, inches: Number(e.target.value) })}
            />
            <span>in</span>
          </div>
        </label>
        <label>
          Room length
          <div className="feet-in-input">
            <input
              type="number"
              min={0}
              value={length.feet}
              onChange={(e) => setLength({ ...length, feet: Number(e.target.value) })}
            />
            <span>ft</span>
            <input
              type="number"
              min={0}
              max={11}
              value={length.inches}
              onChange={(e) => setLength({ ...length, inches: Number(e.target.value) })}
            />
            <span>in</span>
          </div>
        </label>
        <button className="primary" onClick={apply}>
          Apply room size
        </button>
        <button className="danger" onClick={clearAll}>
          Clear layout
        </button>
      </div>
    </div>
  );
}
