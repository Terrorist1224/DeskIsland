const GRID_SIZE = 16;

function snapPointToGrid(point, cellSize = GRID_SIZE) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be a positive finite number');
  return {
    x: Math.round(point.x / cellSize) * cellSize,
    y: Math.round(point.y / cellSize) * cellSize,
  };
}

/** Aligns the nearest compatible edges when tiles are close enough. */
function findMagnetPosition(moving, anchors, threshold = 16) {
  const candidates = [];
  for (const anchor of anchors) {
    if (anchor.id === moving.id) continue;
    const verticalOverlap = moving.y < anchor.y + anchor.height && moving.y + moving.height > anchor.y;
    const horizontalOverlap = moving.x < anchor.x + anchor.width && moving.x + moving.width > anchor.x;
    if (verticalOverlap) {
      candidates.push({ axis: 'x', delta: anchor.x - (moving.x + moving.width), distance: Math.abs(anchor.x - (moving.x + moving.width)) });
      candidates.push({ axis: 'x', delta: anchor.x + anchor.width - moving.x, distance: Math.abs(anchor.x + anchor.width - moving.x) });
    }
    if (horizontalOverlap) {
      candidates.push({ axis: 'y', delta: anchor.y - (moving.y + moving.height), distance: Math.abs(anchor.y - (moving.y + moving.height)) });
      candidates.push({ axis: 'y', delta: anchor.y + anchor.height - moving.y, distance: Math.abs(anchor.y + anchor.height - moving.y) });
    }
  }
  const nearest = candidates.filter(({ distance }) => distance <= threshold)
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest) return null;
  return nearest.axis === 'x'
    ? { x: moving.x + nearest.delta, y: moving.y }
    : { x: moving.x, y: moving.y + nearest.delta };
}

function moveTileGroup(tiles, groupIds, delta, cellSize = GRID_SIZE) {
  if (groupIds.size === 0) return tiles;
  const snappedDelta = snapPointToGrid(delta, cellSize);
  return tiles.map((tile) => groupIds.has(tile.id)
    ? { ...tile, x: tile.x + snappedDelta.x, y: tile.y + snappedDelta.y }
    : tile);
}

function sizeSteps(base) {
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  const minimum = gcd(base.width/GRID_SIZE,base.height/GRID_SIZE);
  return { width:base.width/minimum,height:base.height/minimum,minimum };
}

function sizeAtScale(base, scale, available = { width:Infinity,height:Infinity }) {
  const step=sizeSteps(base);
  const minimum=Math.ceil((base.minimumWidth ?? base.width)/step.width);
  const maximum=Math.min(step.minimum*2,Math.floor(available.width/step.width),Math.floor(available.height/step.height));
  if(maximum<minimum) throw new RangeError('显示器工作区无法容纳磁贴的最小尺寸');
  const count=Math.max(minimum,Math.min(maximum,Math.round(step.minimum*scale)));
  return { width:count*step.width,height:count*step.height };
}

// All coordinates are Electron DIP; each display's work area is its own lattice origin.
function fitBoundsToGrid(bounds, base, area) {
  const size=sizeAtScale(base,bounds.width/base.width,area);
  const point=snapPointToGrid({x:bounds.x-area.x,y:bounds.y-area.y});
  const maxX=Math.floor((area.width-size.width)/GRID_SIZE)*GRID_SIZE;
  const maxY=Math.floor((area.height-size.height)/GRID_SIZE)*GRID_SIZE;
  return {x:area.x+Math.max(0,Math.min(maxX,point.x)),y:area.y+Math.max(0,Math.min(maxY,point.y)),...size};
}

function resizeFromCorner(start, base, corner, delta, area) {
  if(!['nw','ne','sw','se'].includes(corner)) throw new TypeError('Invalid resize corner');
  const left=corner.includes('w'),top=corner.includes('n');
  const fixedX=left?start.x+start.width:start.x;
  const fixedY=top?start.y+start.height:start.y;
  const available={width:left?fixedX-area.x:area.x+area.width-fixedX,height:top?fixedY-area.y:area.y+area.height-fixedY};
  const step=sizeSteps(base);
  // Project the pointer delta onto the ratio vector so either axis can drive proportional resizing.
  const change=((left?-delta.x:delta.x)*step.width+(top?-delta.y:delta.y)*step.height)/(step.width**2+step.height**2);
  const scale=(start.width/step.width+change)/step.minimum;
  const size=sizeAtScale(base,scale,available);
  return {x:left?fixedX-size.width:fixedX,y:top?fixedY-size.height:fixedY,...size};
}

module.exports = { GRID_SIZE, snapPointToGrid, findMagnetPosition, moveTileGroup, sizeAtScale, fitBoundsToGrid, resizeFromCorner };
