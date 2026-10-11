const test = require('node:test');
const assert = require('node:assert/strict');
const { GRID_SIZE, fitBoundsToGrid, resizeFromCorner, sizeAtScale } = require('../src/shared/grid.cjs');

test('compact catalog minima shrink from each corner and keep the opposite grid edges',()=>{
  const catalog=require('../src/shared/widget-catalog.json');
  const minima=[[160,160],[256,128],[160,128],[160,160]];
  catalog.flatMap(item=>item.variants).filter(item=>!item.size.freeResize).forEach(({size:base},index)=>{
    assert.deepEqual(sizeAtScale(base,0),{width:minima[index][0],height:minima[index][1]});
    const start={x:-960,y:160,width:base.width,height:base.height};
    const area={x:-1280,y:0,width:1280,height:960};
    for(const corner of ['nw','ne','sw','se']) {
      const left=corner.includes('w'),top=corner.includes('n');
      const next=resizeFromCorner(start,base,corner,{x:left?999:-999,y:top?999:-999},area);
      assert.equal(next.width,minima[index][0]);assert.equal(next.height,minima[index][1]);
      assert.equal(left?next.x+next.width:next.x,left?start.x+start.width:start.x);
      assert.equal(top?next.y+next.height:next.y,top?start.y+start.height:start.y);
      for(const edge of [next.x-area.x,next.y-area.y,next.width,next.height])assert.equal(edge%16,0);
    }
  });
});

test('all catalog ratios scale in integer grid cells and preserve opposite corners', () => {
  assert.equal(GRID_SIZE,16);
  for (const base of [{width:240,height:240},{width:416,height:208},{width:240,height:192}]) {
    const start={x:-960,y:160,...base};
    const area={x:-1280,y:0,width:1280,height:960};
    for (const corner of ['nw','ne','sw','se']) {
      const left=corner.includes('w'),top=corner.includes('n');
      const next=resizeFromCorner(start,base,corner,{x:left?-100:100,y:top?-100:100},area);
      assert.equal(next.width*base.height,next.height*base.width);
      assert.equal(next.width%16,0); assert.equal(next.height%16,0);
      assert.equal(left?next.x+next.width:next.x,left?start.x+start.width:start.x);
      assert.equal(top?next.y+next.height:next.y,top?start.y+start.height:start.y);
      assert.ok(next.width>=base.width && next.width<=base.width*2);
      assert.ok(next.x>=area.x && next.y>=area.y);
      assert.ok(next.x+next.width<=area.x+area.width);
      assert.ok(next.y+next.height<=area.y+area.height);
      assert.deepEqual(resizeFromCorner(start,base,corner,{x:left?999:-999,y:top?999:-999},area),start);
    }
  }
});

test('work area edges use the last legal grid point, including negative monitor origins', () => {
  assert.deepEqual(fitBoundsToGrid({x:-23,y:719,width:240,height:240},{width:240,height:240},{x:-1280,y:7,width:1280,height:713}),{x:-240,y:471,width:240,height:240});
  assert.deepEqual(sizeAtScale({width:240,height:192},1.5),{width:400,height:320});
  assert.throws(()=>fitBoundsToGrid({x:0,y:0,width:240,height:240},{width:240,height:240},{x:0,y:0,width:100,height:100}),/工作区/);
});
