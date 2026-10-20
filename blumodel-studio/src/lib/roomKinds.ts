/** Rooms you can add with one tap, each with a sensible starting size (inches, width x length). */
export interface RoomKind {
  id: string;
  label: string;
  widthIn: number;
  lengthIn: number;
  blurb: string;
  /** What joins it to the room it is set beside: a walkway for open rooms, a door for a bath or bedroom. */
  link: { productId: 'walkway' | 'opening' | 'door'; widthIn: number };
}

export const ROOM_KINDS: RoomKind[] = [
  { id: 'living', label: 'Living room', widthIn: 192, lengthIn: 168, blurb: "16′ × 14′", link: { productId: 'walkway', widthIn: 96 } },
  { id: 'dining', label: 'Dining room', widthIn: 144, lengthIn: 132, blurb: "12′ × 11′", link: { productId: 'walkway', widthIn: 72 } },
  { id: 'pantry', label: 'Pantry', widthIn: 72, lengthIn: 72, blurb: "6′ × 6′", link: { productId: 'opening', widthIn: 36 } },
  { id: 'bath', label: 'Bathroom', widthIn: 96, lengthIn: 120, blurb: "8′ × 10′", link: { productId: 'door', widthIn: 30 } },
  { id: 'powder', label: 'Powder room', widthIn: 60, lengthIn: 72, blurb: "5′ × 6′", link: { productId: 'door', widthIn: 30 } },
  { id: 'bedroom', label: 'Bedroom', widthIn: 144, lengthIn: 144, blurb: "12′ × 12′", link: { productId: 'door', widthIn: 32 } },
  { id: 'laundry', label: 'Laundry', widthIn: 96, lengthIn: 96, blurb: "8′ × 8′", link: { productId: 'door', widthIn: 30 } },
  { id: 'mudroom', label: 'Mudroom', widthIn: 96, lengthIn: 84, blurb: "8′ × 7′", link: { productId: 'walkway', widthIn: 48 } },
  { id: 'hallway', label: 'Hallway', widthIn: 42, lengthIn: 144, blurb: "3′6″ × 12′", link: { productId: 'walkway', widthIn: 42 } },
  { id: 'hall', label: 'Hall or entry', widthIn: 72, lengthIn: 120, blurb: "6′ × 10′", link: { productId: 'walkway', widthIn: 48 } },
  { id: 'office', label: 'Office', widthIn: 120, lengthIn: 120, blurb: "10′ × 10′", link: { productId: 'door', widthIn: 32 } },
];
