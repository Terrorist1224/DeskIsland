export interface TileRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridPoint { x: number; y: number }
export const GRID_SIZE: 16;
export interface GridSize { width: number; height: number; minimumWidth?: number }
export interface GridBounds extends GridPoint, GridSize {}
export function sizeAtScale(base: GridSize, scale: number, available?: GridSize): GridSize;
export function fitBoundsToGrid(bounds: GridBounds, base: GridSize, area: GridBounds): GridBounds;
export function resizeFromCorner(start: GridBounds, base: GridSize, corner: 'nw'|'ne'|'sw'|'se', delta: GridPoint, area: GridBounds): GridBounds;

export function snapPointToGrid(point: GridPoint, cellSize?: number): GridPoint;
export function findMagnetPosition(moving: TileRect, anchors: TileRect[], threshold?: number): GridPoint | null;
export function moveTileGroup(tiles: TileRect[], groupIds: Set<string>, delta: GridPoint, cellSize?: number): TileRect[];
