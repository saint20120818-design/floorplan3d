const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
assert.equal((html.match(/<\/html>/g) || []).length, 1);
for (const [, attrs, source] of scripts) {
  if (attrs.includes('importmap')) { JSON.parse(source); continue; }
  const result = spawnSync(process.execPath, ['--check', '--input-type=' + (attrs.includes('module') ? 'module' : 'commonjs')], {input: source, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
const source = scripts.find(s => s[2].includes('const LANG_KEY'))[2];
const context = vm.createContext({assert, structuredClone, localStorage: {getItem: () => null}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'layout-editor.js'), 'utf8'), context);
vm.runInContext(source.slice(0, source.indexOf('const PX_MM')) + source.slice(source.indexOf('const area ='), source.indexOf('function aabb(')), context);
vm.runInContext(`
const expected = {bedroom:[3350,2450],master:[2450,3500],dressing:[1950,2500],living:[2700,3500],dining:[2350,2550],kitchen:[1550,2800],balcony:[3250,1300]};
for (const [id, dimensions] of Object.entries(expected)) {
  const r = ROOMS.find(r=>r.id===id), b = bbox(r.poly);
  assert.equal(b[2]-b[0], dimensions[0], id+' width');
  assert.equal(b[3]-b[1], dimensions[1], id+' depth');
}
const geometry = JSON.stringify([ROOMS,WALLS,WINS,DOORS]);
const bedroomDoor=DOORS.find(d=>d.name==='臥室門');
assert.equal(bedroomDoor.rect[1],2450,'Bedroom enters from the hallway along its south edge');
assert.equal(bedroomDoor.rect[2]-bedroomDoor.rect[0],900);
LENGTH_UNIT='cm'; assert.equal(lengthValue(3350),335); assert.equal(lengthValue(1225),122.5);
assert.equal(Number('180')*lengthFactor(),1800);
LENGTH_UNIT='mm'; assert.equal(lengthValue(3350),3350); assert.equal(Number('1800')*lengthFactor(),1800);
AREA_UNIT='ping'; assert.equal(areaValue(100),30.25); assert.equal(areaText(400/121),'1.00 坪');
FX_RATE=5; assert.equal(money(320),'NT$1,600');
assert.equal(unitPrice(320),'NT$5,289/坪');
AREA_UNIT='m2'; assert.equal(unitPrice(320),'NT$1,600/m²');
assert.equal(JSON.stringify([ROOMS,WALLS,WINS,DOORS]),geometry,'Display changes must not alter geometry');
const current=defaultState(); assert.equal(fixState(JSON.parse(JSON.stringify(current))).planId,PLAN_ID);
assert.throws(()=>fixState({furniture:[],rooms:{}}));
assert.equal(current.furniture.length,9);
for (const w of [...WALLS,...WINS,...DOORS.map(d=>d.rect),...SLIDES.map(d=>d.rect)]) {
  assert.ok(w[2]>w[0] && w[3]>w[1], 'Positive rectangle');
}
for (const d of DOORS) {
  const r=d.rect;
  assert.equal(Math.max(r[2]-r[0],r[3]-r[1]),d.len,d.name+' opening length');
}
// Clip any floor polygon against an axis-aligned wall/void rectangle.
function overlap(poly, rect) {
  let p=poly;
  for(const [axis,value,sign] of [[0,rect[0],1],[0,rect[2],-1],[1,rect[1],1],[1,rect[3],-1]]) {
    const output=[];
    for(let i=0;i<p.length;i++) {
      const a=p[i],b=p[(i+1)%p.length],ai=(a[axis]-value)*sign>=0,bi=(b[axis]-value)*sign>=0;
      if(ai)output.push(a);
      if(ai!==bi){const t=(value-a[axis])/(b[axis]-a[axis]);output.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
    }
    p=output;
  }
  return p.length?area(p):0;
}
for(const r of ROOMS) {
  for(const v of VOIDS)assert.ok(overlap(r.poly,bbox(v.poly))<1e-8,r.id+' overlaps void');
  for(const w of WALLS)assert.ok(overlap(r.poly,w)<1e-8,r.id+' overlaps wall '+JSON.stringify(w));
}
for(const d of [...DOORS,...SLIDES])for(const w of WALLS) {
  const r=d.rect;
  assert.ok(Math.min(r[2],w[2])<=Math.max(r[0],w[0]) || Math.min(r[3],w[3])<=Math.max(r[1],w[1]),'Blocked opening '+JSON.stringify(r));
}
const edited=defaultState();
edited.layoutEdits=normalizeLayoutEdits({rooms:{terrace:{width:1200,depth:1000},terrace2:{deleted:true}},walls:{w0:{width:120,depth:6000}},doors:{door0:{x:300,axis:'horizontal',width:900,depth:150,hinge:'end',swing:-1}},windows:{win0:{deleted:true}},slides:{slide0:{width:900}}});
let derived=deriveLayout(edited);
assert.equal(area(derived.rooms.find(r=>r.id==='terrace').poly),1.2);
assert.equal(derived.rooms.find(r=>r.id==='terrace2').hidden,true);
assert.equal(derived.walls.length,BASE_WALLS.length,'Stable wall indices');
assert.equal(derived.walls[0][2]-derived.walls[0][0],120);
assert.equal(derived.doors[0].len,900);
assert.equal(derived.doors[0].h[0],1200);
assert.equal(derived.doors[0].c[0],-1);
assert.equal(derived.doors[0].o[1],-1);
assert.equal(derived.windows[0].hidden,true);
assert.equal(derived.slides[0].rect[2]-derived.slides[0].rect[0],900);
const saved=JSON.parse(JSON.stringify(edited));
assert.equal(JSON.stringify(deriveLayout(fixState(saved))),JSON.stringify(derived),'Export/import round trip');
delete edited.layoutEdits.rooms.terrace;
assert.equal(area(deriveLayout(edited).rooms.find(r=>r.id==='terrace').poly),2.08,'Reset one object');
assert.equal(defaultState().layoutEdits && Object.keys(defaultState().layoutEdits).length,0,'Reset all edits');
assert.throws(()=>normalizeLayoutEdits({rooms:{terrace:{width:0}}}));
assert.throws(()=>normalizeLayoutEdits({walls:{w0:{depth:Infinity}}}));
const added=defaultState();
added.layoutAdded=normalizeLayoutAdded({walls:[{id:'custom-wall-test',rect:[0,0,2000,120]}],windows:[{id:'custom-window-test',rect:[400,0,1600,120]}]});
added.layoutEdits=normalizeLayoutEdits({walls:{'custom-wall-test':{width:2400}},windows:{'custom-window-test':{width:1000}}},added.layoutAdded);
let custom=deriveLayout(added);
assert.equal(custom.walls.at(-1).layoutId,'custom-wall-test');
assert.equal(custom.walls.at(-1)[2],2400);
assert.equal(custom.windows.at(-1)[2],1400);
assert.equal(JSON.stringify(deriveLayout(fixState(JSON.parse(JSON.stringify(added))))),JSON.stringify(custom),'Added objects and edits survive save/import');
assert.equal(JSON.stringify(wallPieces(custom.walls.at(-1),custom.windows)),JSON.stringify([[0,0,400,120],[1400,0,2400,120]]),'Window cuts wall');
added.layoutEdits.windows['custom-window-test'].deleted=true;
custom=deriveLayout(added);
assert.equal(JSON.stringify(wallPieces(custom.walls.at(-1),custom.windows)),JSON.stringify([[0,0,2400,120]]),'Deleting window restores solid wall');
added.layoutEdits.windows['custom-window-test']={x:800};
custom=deriveLayout(added);
assert.equal(JSON.stringify(wallPieces(custom.walls.at(-1),custom.windows)),JSON.stringify([[0,0,800,120],[2000,0,2400,120]]),'Moving window restores old opening');
const vertical=Object.assign([0,400,120,1600],{customId:'custom-v'});
assert.equal(JSON.stringify(wallPieces([0,0,120,2000],[vertical])),JSON.stringify([[0,0,120,400],[0,1600,120,2000]]));
assert.throws(()=>normalizeLayoutAdded({walls:[{id:'custom-bad',rect:[0,0,0,100]}]}));
assert.throws(()=>normalizeLayoutAdded({windows:[{id:'custom-bad',rect:[0,0,Infinity,100]}]}));
assert.throws(()=>normalizeLayoutAdded({walls:[{id:'custom-duplicate',rect:[0,0,100,100]},{id:'custom-duplicate',rect:[0,0,100,100]}]}));
const dragBox=[100,200,2100,320];
assert.equal(JSON.stringify(layoutDragPatch(dragBox,'move',126,-44)),JSON.stringify({x:230,y:160,width:2000,depth:120}));
assert.equal(JSON.stringify(layoutDragPatch(dragBox,'move',126,-44,{fine:true})),JSON.stringify({x:226,y:156,width:2000,depth:120}));
assert.equal(JSON.stringify(layoutDragPatch(dragBox,'move',126,-44,{axisLock:true})),JSON.stringify({x:230,y:200,width:2000,depth:120}));
assert.equal(JSON.stringify(layoutDragPatch(dragBox,'e',400,900)),JSON.stringify({x:100,y:200,width:2400,depth:120}),'Length handle preserves thickness');
assert.equal(JSON.stringify(layoutDragPatch(dragBox,'w',-300,0)),JSON.stringify({x:-200,y:200,width:2300,depth:120}),'Opposite edge stays fixed');
assert.equal(layoutDragPatch(dragBox,'w',9000,0).width,10,'Cannot invert or collapse wall');
assert.equal(layoutDragPatch(dragBox,'e',90000,0).width,50000,'Maximum length');
assert.equal(JSON.stringify(layoutDragPatch([100,200,220,2200],'n',900,500)),JSON.stringify({x:100,y:700,width:120,depth:1500}),'Vertical length handle');
assert.equal(JSON.stringify(layoutDragPatch([100,200,2100,3200],'nw',-500,-300)),JSON.stringify({x:-400,y:-100,width:2500,depth:3300}),'Room corner resize');
assert.equal(layoutDragPatch(dragBox,'move',-90000,90000).x,-50000);
assert.equal(layoutDragPatch(dragBox,'move',-90000,90000).y,50000);
const labelled=defaultState(), beforeLabels=JSON.stringify(deriveLayout(labelled));
labelled.labelOffsets=normalizeLabelOffsets({'room:mbath:name':{x:350.2,y:-410.8},'dim:mbath:h:0':{x:0,y:550},'furn:fixture-1':{x:200,y:0}});
assert.equal(labelled.labelOffsets['room:mbath:name'].y,-411);
assert.equal(JSON.stringify(fixState(JSON.parse(JSON.stringify(labelled))).labelOffsets),JSON.stringify(labelled.labelOffsets),'Label positions survive JSON round trip');
assert.equal(JSON.stringify(deriveLayout(labelled)),beforeLabels,'Moving text cannot alter geometry');
assert.throws(()=>normalizeLabelOffsets({'room:mbath:name':{x:Infinity,y:0}}));
assert.throws(()=>normalizeLabelOffsets({'room:mbath:name':{x:0,y:50001}}));
assert.equal(Object.keys(normalizeLabelOffsets({'bad-id':{x:0,y:0}})).length,0);
assert.equal(JSON.stringify([ROOMS,WALLS,WINS,DOORS]),geometry,'Edits never mutate base geometry');
`, context);
const gestureContext=vm.createContext({assert});
vm.runInContext(`
let state={x:10},drag=null,commits=[],renders=0;
const svg={classList:{remove(){}}},snap=()=>JSON.stringify(state),commit=before=>commits.push(before),renderAll=()=>renders++;
`+source.slice(source.indexOf('function endDrag(cancel)'),source.indexOf("svg.addEventListener('pointerdown'"))+`
drag={kind:'layout',before:'{"x":0}',moved:true};endDrag(false);
assert.equal(commits.length,1);assert.equal(state.x,10);assert.equal(drag,null);
state={x:20};drag={kind:'layout',before:'{"x":10}',moved:true};endDrag(true);
assert.equal(state.x,10,'Cancel restores the whole pre-gesture state');assert.equal(commits.length,1,'Cancel does not create history');
drag={kind:'layout',before:'{"x":10}',moved:false};endDrag(false);
assert.equal(commits.length,1,'Clicking without moving does not create history');assert.equal(renders,3);
state={labelOffsets:{'room:mbath:name':{x:500,y:200}}};drag={kind:'label',before:'{"labelOffsets":{}}',moved:true};endDrag(true);
assert.equal(Object.keys(state.labelOffsets).length,0,'Cancelled text drag restores offsets');assert.equal(commits.length,1);
state={labelOffsets:{'room:mbath:name':{x:500,y:200}}};drag={kind:'label',before:'{"labelOffsets":{}}',moved:true};endDrag(false);
assert.equal(commits.length,2,'Text drag is a single undo action');
`,gestureContext);
console.log('PASS: syntax, dimensions, conversions, geometry, layout editing, additions, window cuts, drag/resize constraints, gesture commit/cancel, stable IDs and JSON round trip.');
