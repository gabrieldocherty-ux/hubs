# Free-form rooms (walls, doorways, extra rooms)

Goal (Gabe, 2026-10-19): nobody picks a room type or shape. They draw walls, place doorways and
windows on them, add more rooms, and drop cabinets and appliances that snap. The detail has to
stand up to a working kitchen designer (The Cabinet Studio, Guelph, is the bar). Same customers as
before: kitchen, bath and reno companies; their clients use the designer on the company's showroom.

## Data contract (shared by browser and server)

`DesignDoc.room` keeps `widthIn`, `lengthIn`, `ceilingIn` (the bounding box, so everything that
reads them keeps working) and gains two optional fields:

- `outline`: `[x, y][]`, 4 to 64 corners, inches from the plan's north-west origin, y growing
  south. Every wall is straight across or straight up and down. No wall under 12". Absent means the
  plain rectangle, so every saved kitchen loads unchanged.
- `extra`: up to 8 `{ id, name, outline, ceilingIn? }`, more rooms in the same coordinate space.

Doorways and windows stay `PlacedItem`s (`kind: door | window`) sitting on a wall line, so saved
designs, estimates and exports need no new object type.

Code: `src/lib/outline.ts` (geometry, validation, drawing snaps), `src/lib/doc.ts` `cleanRoom`
(browser), `server/lib/doc.mjs` `cleanShape` (server). The two validators must stay in step.

## Build order

1. Model and validation (done): outline.ts, cleanRoom, normalizeDoc.
2. Geometry: walls become segments (`wallSegs(room)`), so snapping, flush checks, backsplash and
   clamping work on any wall (`src/lib/geometry.ts`).
3. Draw tool: click corners, snaps to square and grid and existing corners, type a length, close the
   loop; quick rectangle; edit a corner or wall length later; doorway and window tools on walls.
4. Plan and 3D drawing: floor polygon, wall pieces per segment, cut-away per wall.
5. Extra rooms: "Add a room" from the room panel.
6. Server: renders scene description, export kit, quote and lead summaries read the outline.
7. Professional pass: see the audit list in the session log.

## Added after the first pass (2026-10-19)

- **Add a room by kind** (plan: Add a room ▾; sketcher: Add a room…): living room, dining room, pantry,
  bathroom, powder room, bedroom, laundry, mudroom, hallway, hall/entry, office. It lands beside the
  rooms already there so it shares a wall, and is joined with what that kind uses: a walkway (living,
  dining, mudroom, hall, hallway), a cased doorway (pantry) or a door (bath, bedroom, laundry, office).
  Kinds and links: `src/lib/roomKinds.ts`; placement and joining: `addRoomOfKind` in `src/lib/roomEdit.ts`.
- **Walkways**: product `walkway` (variant `opening`, 48-144" wide). An opening with a room behind it shows that room in 3D (no painted backdrop).
- **Open areas and edge styles** (`EdgeStyle` in `src/types.ts`, `EDGE_STYLES` in `src/lib/outline.ts`): wall, half, bar, rail, glass, beam, open. A wall shared by two rooms changes on both sides.
- Server validation (`server/lib/doc.mjs`) keeps `room.styles`, and `extra[].kind` and `extra[].styles`; `server/test/rooms-doc.test.mjs` covers it.
