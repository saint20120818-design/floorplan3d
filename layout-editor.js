// 可儲存的格局覆寫；原始資料保持不變，刪除項目保留穩定 ID。
const LAYOUT_TYPES = ['rooms', 'walls', 'windows', 'doors', 'slides'];
function readPlanTransfer(text) {
  const raw=JSON.parse(text.replace(/^\uFEFF/,''));
  if(!raw || typeof raw!=='object' || !Array.isArray(raw.furniture))throw new Error('檔案不是方案 JSON');
  if(raw.exportVersion && raw.exportVersion!==1)throw new Error('檔案版本較新，請重新整理網頁後再匯入');
  const plan=fixState(structuredClone(raw));
  const ids=new Set();
  for(const f of plan.furniture){
    if(!f || typeof f.id!=='string' || ids.has(f.id) || !['cx','cy','w','d','rot'].every(k=>typeof f[k]==='number' && Number.isFinite(f[k])) || f.w<=0 || f.d<=0 || typeof f.type!=='string')throw new Error('家具資料不完整，請從原電腦重新匯出');
    ids.add(f.id);
  }
  for(const r of Object.values(plan.rooms))if(!r || !MATS[r.mat])throw new Error('地面材料資料無效');
  const display=raw.display || {};
  delete plan.exportVersion;delete plan.exportedAt;delete plan.display;
  return {plan,display};
}
function writePlanTransfer(plan,display) {
  return JSON.stringify({...structuredClone(plan),exportVersion:1,exportedAt:new Date().toISOString(),display:structuredClone(display)},null,2);
}
function normalizeLabelOffsets(input) {
  const result={};
  if(input===undefined || input===null)return result;
  if(typeof input!=='object' || Array.isArray(input))throw new Error('Invalid label offsets');
  for(const [id,offset] of Object.entries(input)) {
    if(!/^(room|dim|void|furn):[a-zA-Z0-9:_-]{1,160}$/.test(id))continue;
    if(!offset || !['x','y'].every(k=>typeof offset[k]==='number' && Number.isFinite(offset[k]) && Math.abs(offset[k])<=50000))throw new Error('Invalid label position');
    result[id]={x:Math.round(offset.x),y:Math.round(offset.y)};
  }
  return result;
}
function planLabel(id,markup,title) {
  const o=state.labelOffsets?.[id] || {x:0,y:0};
  return `<g data-label-id="${esc(id)}" data-label-title="${esc(title)}" transform="translate(${o.x} ${o.y})">${markup}</g>`;
}
function furnitureDimensions(f) {
  const a=f.rot*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
  const world=(x,y)=>[f.cx+x*c-y*s,f.cy+x*s+y*c];
  const color='#8d522f', gap=180, tick=45, fs=130;
  const line=(x0,y0,x1,y1)=>{const p=world(x0,y0),q=world(x1,y1);return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${color}" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;};
  const text=(key,x,y,value,angle)=>{
    const p=world(x,y);angle=((angle%360)+360)%360;if(angle>90 && angle<=270)angle-=180;
    return planLabel('furn:'+f.id+':'+key,`<text x="${p[0]}" y="${p[1]}" transform="rotate(${angle} ${p[0]} ${p[1]})" font-size="${fs}" text-anchor="middle" fill="${color}" stroke="#fbf9f4" stroke-width="35" paint-order="stroke">${lengthText(value)}</text>`,nm(f.name)+tr(key==='width'?'・寬度 ':'・深度 ',key==='width'?' · width ':' · depth ')+lengthText(value));
  };
  const left=-f.w/2,right=f.w/2,top=-f.d/2,bottom=f.d/2;
  return line(left,bottom+gap,right,bottom+gap)+line(left,bottom+gap-tick,left,bottom+gap+tick)+line(right,bottom+gap-tick,right,bottom+gap+tick)
    +line(right+gap,top,right+gap,bottom)+line(right+gap-tick,top,right+gap+tick,top)+line(right+gap-tick,bottom,right+gap+tick,bottom)
    +text('width',0,bottom+gap+fs+25,f.w,f.rot)+text('depth',right+gap+fs+25,0,f.d,f.rot-90);
}
function visiblePlanLabels() {
  return [...svg.querySelectorAll('g[data-label-id]')].filter(el=>!el.closest('[display="none"]'));
}
function selectedLabelElement() {return visiblePlanLabels().find(el=>el.dataset.labelId===ui.sel?.id);}
function labelSelectionSVG() {
  const el=selectedLabelElement(); if(!el)return '';
  const rect=el.getBoundingClientRect(), matrix=svg.getScreenCTM(); if(!matrix || !rect.width)return '';
  const convert=(x,y)=>{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(matrix.inverse());};
  const a=convert(rect.left,rect.top), b=convert(rect.right,rect.bottom), gap=4/view.s;
  return `<rect data-label-id="${esc(el.dataset.labelId)}" x="${a.x-gap}" y="${a.y-gap}" width="${b.x-a.x+2*gap}" height="${b.y-a.y+2*gap}" fill="transparent" stroke="#b5653a" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="all" style="cursor:move"/>`;
}
function labelEditorPanel() {
  const labels=visiblePlanLabels().filter(el=>el.tagName.toLowerCase()==='g'), id=ui.sel?.kind==='label'?ui.sel.id:'', o=state.labelOffsets?.[id] || {x:0,y:0};
  return `<section><h3>${tr('文字位置','Label positions')}</h3><p>${tr('直接拖曳房名、面積、尺寸數字或家具名稱。只調整 2D 文字位置，實際格局與數值不變。','Drag room names, areas, dimension numbers or furniture names. This changes 2D label positions only, not geometry or values.')}</p>
    <label>${tr('選擇文字（重疊時可用清單）','Choose label (for overlapping text)')}<select id="labelChoice" aria-label="${tr('選擇文字','Choose label')}"><option value="">${tr('請選擇文字','Choose a label')}</option>${labels.map(el=>`<option value="${esc(el.dataset.labelId)}" ${id===el.dataset.labelId?'selected':''}>${esc(el.dataset.labelTitle)}</option>`).join('')}</select></label>
    <p class="muted">${tr('選取後可拖曳橘色虛線框。若找不到文字，請開啟上方「房間」「尺寸」或「傢俱」圖層。','Drag the orange selection outline. Enable Rooms, Dimensions or Furniture above if labels are hidden.')}</p></section>
    ${id?`<section><h3>${esc(selectedLabelElement()?.dataset.labelTitle || tr('已選文字','Selected label'))}</h3><form id="labelForm"><div class="form">${['x','y'].map(k=>`<label>${k==='x'?tr('水平位移','Horizontal offset'):tr('垂直位移','Vertical offset')} (${LENGTH_UNIT})<input name="${k}" type="number" value="${lengthValue(o[k])}" step="${1/lengthFactor()}" min="${-50000/lengthFactor()}" max="${50000/lengthFactor()}" required></label>`).join('')}</div><div class="actions"><button class="btn" type="submit">${tr('套用位置','Apply position')}</button><button class="btn" id="labelReset" type="button">${tr('還原此文字','Reset this label')}</button></div></form></section>`:''}
    <section><p class="muted">${tr('位置會自動儲存並隨 JSON 匯出。Ctrl/⌘＋Z 復原，Esc 取消拖曳。','Positions save automatically and export with JSON. Ctrl/⌘+Z undoes; Esc cancels a drag.')}</p><div class="actions"><button class="btn" id="labelsReset">${tr('還原全部文字位置','Reset all label positions')}</button><button class="btn" id="labelsDone">${tr('完成','Done')}</button></div></section>`;
}
function bindLabelEditor() {
  $('#labelChoice').onchange=e=>select(e.target.value?{kind:'label',id:e.target.value}:null);
  $('#labelsReset').onclick=()=>mutate(()=>{state.labelOffsets={};});
  $('#labelsDone').onclick=()=>setTool('select');
  const form=$('#labelForm'); if(!form)return;
  form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;const data=new FormData(form), id=ui.sel.id;
    mutate(()=>{state.labelOffsets=normalizeLabelOffsets({...state.labelOffsets,[id]:{x:Number(data.get('x'))*lengthFactor(),y:Number(data.get('y'))*lengthFactor()}});});};
  $('#labelReset').onclick=()=>mutate(()=>{if(state.labelOffsets)delete state.labelOffsets[ui.sel.id];});
}
function beginLabelDrag(e,p,id) {
  select({kind:'label',id});
  drag={kind:'label',id,start:p,offset:{...(state.labelOffsets?.[id] || {x:0,y:0})},sx:e.clientX,sy:e.clientY,pid:e.pointerId,before:snap(),moved:false};
  svg.setPointerCapture(e.pointerId);e.preventDefault();
}
function previewLabelDrag(e,p) {
  if(e.pointerId!==drag.pid || (!drag.moved && Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)<TAP))return;
  drag.moved=true;
  const o={x:Math.max(-50000,Math.min(50000,Math.round(drag.offset.x+p.x-drag.start.x))),y:Math.max(-50000,Math.min(50000,Math.round(drag.offset.y+p.y-drag.start.y)))};
  state.labelOffsets ??={};state.labelOffsets[drag.id]=o;
  renderFurn();renderLabels();renderDims();renderSel();
  for(const key of ['x','y']){const input=$(`#labelForm [name="${key}"]`);if(input)input.value=lengthValue(o[key]);}
}
function layoutBase(type) {
  return {rooms:BASE_ROOMS, walls:BASE_WALLS, windows:BASE_WINS, doors:BASE_DOORS, slides:BASE_SLIDES}[type] || [];
}
function layoutId(type, item, index) { return item.customId || (type === 'rooms' ? item.id : ({walls:'w',windows:'win',doors:'door',slides:'slide'}[type] + index)); }
function normalizeLayoutAdded(input) {
  const result={walls:[],windows:[]}, ids=new Set();
  for(const type of ['walls','windows']) {
    if(input?.[type] !== undefined && !Array.isArray(input[type])) throw new Error('Invalid added objects');
    for(const o of input?.[type] || []) {
      if(!o || typeof o.id!=='string' || !/^custom-[a-z0-9-]{1,80}$/.test(o.id) || ids.has(o.id) || !Array.isArray(o.rect) || o.rect.length!==4 || o.rect.some(n=>typeof n!=='number' || !Number.isFinite(n) || Math.abs(n)>100000)) throw new Error('Invalid added object');
      const rect=o.rect.map(Math.round), width=rect[2]-rect[0], depth=rect[3]-rect[1];
      if(Math.abs(rect[0])>50000 || Math.abs(rect[1])>50000 || width<10 || depth<10 || width>50000 || depth>50000) throw new Error('Invalid added dimensions');
      ids.add(o.id); result[type].push({id:o.id,rect});
    }
  }
  return result;
}
function layoutCollection(type,plan) {
  return [...layoutBase(type),...(plan.layoutAdded?.[type] || []).map(o=>Object.assign([...o.rect,...(type==='walls'?['n']:[])],{customId:o.id}))];
}
function layoutBox(item, type) {
  if (type !== 'rooms') return (item.rect || item).slice(0,4);
  const xs=item.poly.map(p=>p[0]), ys=item.poly.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
function normalizeLayoutEdits(input,layoutAdded={}) {
  const result={};
  for (const type of LAYOUT_TYPES) {
    const entries={};
    layoutCollection(type,{layoutAdded}).forEach((base,index)=>{
      const id=layoutId(type,base,index), edit=input?.[type]?.[id];
      if (!edit || typeof edit !== 'object') return;
      const clean={};
      if (edit.deleted === true) clean.deleted=true;
      for (const key of ['x','y','width','depth']) {
        if (edit[key] === undefined) continue;
        const n=edit[key];
        if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n)>50000 || (['width','depth'].includes(key) && n<10)) throw new Error('Invalid layout dimensions');
        clean[key]=Math.round(n);
      }
      if (['horizontal','vertical'].includes(edit.axis)) clean.axis=edit.axis;
      if (['start','end'].includes(edit.hinge)) clean.hinge=edit.hinge;
      if (edit.swing === 1 || edit.swing === -1) clean.swing=edit.swing;
      if (Object.keys(clean).length) entries[id]=clean;
    });
    result[type]=entries;
  }
  return result;
}
function deriveLayout(plan) {
  const result={};
  for (const type of LAYOUT_TYPES) {
    result[type]=layoutCollection(type,plan).map((base,index)=>{
      const id=layoutId(type,base,index), edit=plan.layoutEdits?.[type]?.[id] || {};
      const box=layoutBox(base,type), x=edit.x ?? box[0], y=edit.y ?? box[1];
      const width=edit.width ?? box[2]-box[0], depth=edit.depth ?? box[3]-box[1];
      const rect=[x,y,x+width,y+depth];
      const transform=([px,py])=>[x+(px-box[0])*width/(box[2]-box[0]),y+(py-box[1])*depth/(box[3]-box[1])];
      let item;
      if (type==='rooms') item={...base,poly:base.poly.map(transform),at:base.at && transform(base.at)};
      else if (type==='doors') {
        const oldHorizontal=box[2]-box[0]>=box[3]-box[1];
        const horizontal=edit.axis ? edit.axis==='horizontal' : oldHorizontal;
        const oldStart=base.c[oldHorizontal?0:1]>0;
        const start=edit.hinge ? edit.hinge==='start' : oldStart;
        const swing=edit.swing ?? base.o[oldHorizontal?1:0];
        const face=(base.h[oldHorizontal?1:0]-box[oldHorizontal?1:0])/(oldHorizontal?box[3]-box[1]:box[2]-box[0]);
        item={...base,rect,len:horizontal?width:depth,
          h:horizontal?[start?x:x+width,y+face*depth]:[x+face*width,start?y:y+depth],
          c:horizontal?[start?1:-1,0]:[0,start?1:-1],o:horizontal?[0,swing]:[swing,0]};
      } else if (type==='slides') item={...base,rect,v:depth>width};
      else item=[...rect,...base.slice(4)];
      item.layoutId=id; item.baseIndex=index; item.customId=base.customId; item.hidden=!!edit.deleted;
      return item;
    });
  }
  return result;
}
function syncLayoutGeometry() {
  const next=deriveLayout(state);
  // 牆體不可 filter，拆牆紀錄以索引識別；其餘元件使用 layoutId。
  WALLS=next.walls; WINS=next.windows.filter(o=>!o.hidden);
  DOORS=next.doors.filter(o=>!o.hidden); SLIDES=next.slides.filter(o=>!o.hidden);
  ROOMS=next.rooms.filter(o=>!o.hidden);
  const boxes=[...ROOMS.map(r=>layoutBox(r,'rooms')),...WALLS.filter(w=>!w.hidden).map(w=>w.slice(0,4)),...WINS,...DOORS.map(d=>d.rect),...SLIDES.map(d=>d.rect)];
  const minX=Math.min(-1000,...boxes.map(b=>b[0]-700)), minY=Math.min(-1400,...boxes.map(b=>b[1]-700));
  Object.assign(BOUNDS,{x:minX,y:minY,w:Math.max(11500,...boxes.map(b=>b[2]+700))-minX,h:Math.max(8700,...boxes.map(b=>b[3]+700))-minY});
  if (ui.sel?.kind==='room' && !ROOMS.some(r=>r.id===ui.sel.id)) ui.sel=null;
}
function layoutTypeName(type) {
  return {rooms:tr('房間／平台','Rooms / platforms'),walls:tr('牆壁／欄杆','Walls / railings'),windows:tr('窗戶','Windows'),doors:tr('房門','Doors'),slides:tr('拉門','Sliding doors')}[type];
}
function layoutName(type,item,index) {
  const id=layoutId(type,item,index);
  if(type==='rooms') {
    const suffix={terrace:tr('（左）',' (left)'),terrace2:tr('（右）',' (right)'),service:tr('（右側）',' (side)')}[id] || '';
    return nm(state.rooms[id]?.name || item.name)+suffix;
  }
  return (item.customId?tr('新增','Added '):'')+(item.name ? nm(item.name) : layoutTypeName(type))+' #'+(index+1);
}
function layoutSelection() {
  const type=ui.sel?.kind==='layout'?ui.sel.category:'rooms';
  const list=layoutCollection(type,state), requested=ui.sel?.kind==='layout'?ui.sel.id:layoutId(type,list[0],0);
  const index=Math.max(0,list.findIndex((o,i)=>layoutId(type,o,i)===requested));
  return {type,id:layoutId(type,list[index],index),index,base:list[index]};
}
async function openLayoutEditor(type='rooms',id=BASE_ROOMS[0].id) {
  if (is3D()) await setView('2d');
  ui.sel={kind:'layout',category:type,id};
  setTool('layout'); renderPanel(); renderSel(); drawer('panel',true);
  $('#panel').closest('aside').scrollTop=0;
}
function setLayoutEdit(type,id,patch) {
  const all=structuredClone(state.layoutEdits || {});
  all[type] ??= {}; all[type][id]={...(all[type][id] || {}),...patch};
  state.layoutEdits=normalizeLayoutEdits(all,state.layoutAdded);
}
function addLayoutObject(type) {
  const selected=layoutSelection(), item=deriveLayout(state)[selected.type][selected.index];
  const b=layoutBox(item,selected.type), cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2;
  let rect;
  if(type==='windows' && selected.type==='walls' && !item.hidden) {
    if(state.demolished.includes('w'+selected.index) || item[4]==='low') {toast(tr('請先選取未拆除的完整牆壁','Select an intact full-height wall'));return;}
    const horizontal=b[2]-b[0]>=b[3]-b[1], length=Math.min(1200,horizontal?b[2]-b[0]:b[3]-b[1]);
    rect=horizontal?[cx-length/2,b[1],cx+length/2,b[3]]:[b[0],cy-length/2,b[2],cy+length/2];
  } else {
    const width=type==='walls'?2000:1200, depth=type==='walls'?120:150;
    rect=[cx-width/2,cy-depth/2,cx+width/2,cy+depth/2];
  }
  const id='custom-'+crypto.randomUUID();
  mutate(()=>{
    state.layoutAdded=normalizeLayoutAdded(state.layoutAdded);
    state.layoutAdded[type].push({id,rect:rect.map(Math.round)});
    ui.sel={kind:'layout',category:type,id};
  });
  fitView();
  toast(tr('已新增，可在右側調整位置與尺寸','Added. Adjust position and size on the right.'));
}
// Windows remove the overlapping wall footprint; window rendering supplies sill and lintel.
function wallPieces(w,windows) {
  let pieces=[w.slice(0,4)];
  for(const r of windows.filter(o=>o.customId && !o.hidden)) {
    pieces=pieces.flatMap(p=>{
      const x0=Math.max(p[0],r[0]), y0=Math.max(p[1],r[1]), x1=Math.min(p[2],r[2]), y1=Math.min(p[3],r[3]);
      if(x1<=x0 || y1<=y0)return [p];
      return [[p[0],p[1],x0,p[3]],[x1,p[1],p[2],p[3]],[x0,p[1],x1,y0],[x0,y1,x1,p[3]]].filter(b=>b[2]>b[0] && b[3]>b[1]);
    });
  }
  return pieces;
}
function layoutEditorPanel() {
  const {type,id,index,base}=layoutSelection();
  if(!base) return '';
  const item=deriveLayout(state)[type][index], b=layoutBox(item,type), horizontal=type==='doors' ? item.c[0]!==0 : b[2]-b[0]>=b[3]-b[1];
  const fields=[['x',tr('左上角 X','Top-left X'),b[0]],['y',tr('左上角 Y','Top-left Y'),b[1]],
    ['width',tr('水平長度','Horizontal size'),b[2]-b[0]],['depth',tr('垂直長度','Vertical size'),b[3]-b[1]]];
  return `<section><h3>${tr('格局編輯','Layout editor')}</h3>
    <div class="actions"><button class="btn" id="layoutAddWall">＋ ${tr('新增牆壁','Add wall')}</button><button class="btn" id="layoutAddWindow">＋ ${tr('新增窗戶','Add window')}</button></div>
    <p class="muted" style="font-size:12px">${tr('選牆後新增窗，會沿牆置中並開洞；新牆會放在所選物件中央。','Select a wall before adding a window to center it and create an opening. New walls start at the selected object’s center.')}</p>
    <div class="form"><label class="full">${tr('物件類型','Object type')}<select id="layoutType" aria-label="${tr('物件類型','Object type')}">${LAYOUT_TYPES.map(t=>`<option value="${t}" ${t===type?'selected':''}>${layoutTypeName(t)}</option>`).join('')}</select></label>
    <label class="full">${tr('選擇物件（含已刪除）','Object (including deleted)')}<select id="layoutObject" aria-label="${tr('選擇物件（含已刪除）','Object (including deleted)')}">${layoutCollection(type,state).map((o,i)=>{const key=layoutId(type,o,i);return `<option value="${key}" ${key===id?'selected':''}>${esc(layoutName(type,o,i))}${state.layoutEdits?.[type]?.[key]?.deleted?tr('〔已刪除〕',' [deleted]'):''}</option>`;}).join('')}</select></label></div>
    <p class="muted">${tr('拖曳物件或白色十字移動；拉橘色端點改長度，房間／平台拉角點改長寬。','Drag objects or the white cross to move. Orange ends change length; room/platform corners change width and depth.')}</p>
    <p class="muted" style="font-size:12px">${tr('步進 1 cm，Alt 微調 1 mm；Shift 鎖定方向，Esc 取消。放開儲存，Ctrl/⌘＋Z 復原。','1 cm steps; Alt: 1 mm. Shift: axis lock; Esc: cancel. Release to save; Ctrl/⌘+Z: undo.')}</p>
  </section>
  <section><h3>${esc(layoutName(type,base,index))}</h3>
  ${item.hidden?`<p>${tr('此物件已刪除，可按下方按鈕恢復。','This object is deleted. Restore it below.')}</p>`:`<form id="layoutForm"><div class="form">
    ${fields.map(([key,label,value])=>`<label>${label} (${LENGTH_UNIT})<input name="${key}" type="number" value="${lengthValue(value)}" step="${1/lengthFactor()}" ${key==='width'||key==='depth'?`min="${10/lengthFactor()}"`:`min="${-50000/lengthFactor()}"`} max="${50000/lengthFactor()}" required></label>`).join('')}
    ${type==='doors'?`<label>${tr('開口方向','Opening axis')}<select name="axis" aria-label="${tr('開口方向','Opening axis')}"><option value="horizontal" ${horizontal?'selected':''}>${tr('水平','Horizontal')}</option><option value="vertical" ${!horizontal?'selected':''}>${tr('垂直','Vertical')}</option></select></label>
    <label>${tr('鉸鏈端點','Hinge end')}<select name="hinge" aria-label="${tr('鉸鏈端點','Hinge end')}"><option value="start" ${item.c[horizontal?0:1]>0?'selected':''}>${tr('起點（左／上）','Start (left / top)')}</option><option value="end" ${item.c[horizontal?0:1]<0?'selected':''}>${tr('終點（右／下）','End (right / bottom)')}</option></select></label>
    <label class="full">${tr('開門方向','Swing direction')}<select name="swing" aria-label="${tr('開門方向','Swing direction')}"><option value="1" ${item.o[horizontal?1:0]>0?'selected':''}>${tr('朝下／朝右','Down / right')}</option><option value="-1" ${item.o[horizontal?1:0]<0?'selected':''}>${tr('朝上／朝左','Up / left')}</option></select></label>`:''}
    </div><div class="actions"><button class="btn primary" type="submit">${tr('套用修改','Apply changes')}</button></div></form>`}
    ${type==='rooms'&&!item.hidden?`<p class="muted">${areaBoth(area(item.poly))} · ${money(area(item.poly)*MATS[state.rooms[id].mat].price*1.05)}</p>`:''}
    <p class="muted" style="font-size:12px">${tr('房間設定調整地板範圍；牆、柱、門窗、欄杆與家具各自獨立。數字修改固定左上角；拖曳端點固定另一端。不規則輪廓依長寬縮放。','Room settings change the floor footprint. Walls, columns, openings, railings and furniture are independent. Numeric resizing anchors the top-left; dragging anchors the opposite end. Irregular outlines scale with the size.')}</p>
    ${type==='rooms'?`<p class="muted" style="font-size:12px">${tr('面積依各空間範圍加總，請避免空間重疊。','Areas sum individual footprints; avoid overlapping rooms.')}</p>`:''}
    ${type==='windows'?`<p class="muted" style="font-size:12px">${tr('水平窗：水平長度是窗寬，垂直長度是牆厚；直向窗則相反。新增窗的窗台高 90 cm、窗頂高 240 cm；窗戶範圍須涵蓋牆厚才能完整開洞。移動或刪除新增窗，原牆洞會自動補回。','For horizontal windows, horizontal size is window width and vertical size is wall thickness; reverse for vertical windows. Added windows have a 90 cm sill and 240 cm head. Cover the full wall thickness for a complete opening. Moving or deleting an added window restores the previous wall opening.')}</p>`:''}
    ${type==='doors'?`<p class="muted" style="font-size:12px">${tr('水平開口：水平長度是門寬；垂直開口：垂直長度是門寬。另一方向是洞口厚度。移動門窗後，請同步調整相鄰牆段以保留洞口。','The dimension along the opening axis is the door width; the other is opening thickness. Adjust adjacent wall segments after moving openings.')}</p>`:''}
    <div class="actions"><button class="btn danger" id="layoutDelete">${item.hidden?tr('恢復此物件','Restore object'):tr('刪除此物件','Delete object')}</button><button class="btn" id="layoutReset">${tr('還原此物件','Reset object')}</button></div>
    <div class="actions"><button class="btn" id="layoutDone">${tr('完成編輯','Done editing')}</button></div>
    <p class="muted">${tr('修改會自動儲存；Ctrl/⌘＋Z 可復原。','Changes save automatically. Ctrl/⌘+Z undoes them.')}</p>
  </section>`;
}
function bindLayoutEditor() {
  const {type,id}=layoutSelection();
  $('#layoutAddWall').onclick=()=>addLayoutObject('walls');
  $('#layoutAddWindow').onclick=()=>addLayoutObject('windows');
  $('#layoutType').onchange=e=>openLayoutEditor(e.target.value,layoutId(e.target.value,layoutBase(e.target.value)[0],0));
  $('#layoutObject').onchange=e=>openLayoutEditor(type,e.target.value);
  const form=$('#layoutForm');
  if(form) form.onsubmit=e=>{
    e.preventDefault(); if(!form.reportValidity()) return;
    const data=new FormData(form), patch={};
    for(const key of ['x','y','width','depth']) patch[key]=Math.round(Number(data.get(key))*lengthFactor());
    if(type==='doors'){patch.axis=data.get('axis');patch.hinge=data.get('hinge');patch.swing=Number(data.get('swing'));}
    mutate(()=>setLayoutEdit(type,id,patch)); fitView();
    toast(tr('格局已更新','Layout updated'));
  };
  $('#layoutDelete').onclick=()=>mutate(()=>setLayoutEdit(type,id,{deleted:!state.layoutEdits?.[type]?.[id]?.deleted}));
  $('#layoutReset').onclick=()=>mutate(()=>{if(state.layoutEdits?.[type]) delete state.layoutEdits[type][id];});
  $('#layoutDone').onclick=()=>{setTool('select');select(null);};
}
function layoutHits() {
  return [['windows',WINS],['doors',DOORS],['slides',SLIDES]].map(([type,list])=>list.map(o=>{
    const b=layoutBox(o,type);
    return `<rect class="layout-hit" data-layout-type="${type}" data-layout-id="${o.layoutId}" x="${b[0]}" y="${b[1]}" width="${b[2]-b[0]}" height="${b[3]-b[1]}" fill="transparent" stroke="transparent" stroke-width="12" vector-effect="non-scaling-stroke"/>`;
  }).join('')).join('');
}
function layoutSelectionSVG() {
  const {type,index}=layoutSelection();
  const item=deriveLayout(state)[type]?.[index]; if(!item || item.hidden) return '';
  const b=layoutBox(item,type), points=type==='rooms'?item.poly:[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
  const k=1/view.s, cx=(b[0]+b[2])/2, cy=(b[1]+b[3])/2;
  const horizontal=type==='doors'?item.c[0]!==0:b[2]-b[0]>=b[3]-b[1];
  const handles=type==='rooms'?[['nw',b[0],b[1]],['ne',b[2],b[1]],['sw',b[0],b[3]],['se',b[2],b[3]]]
    :horizontal?[['w',b[0],cy],['e',b[2],cy]]:[['n',cx,b[1]],['s',cx,b[3]]];
  const mx=type==='rooms'?cx:horizontal?cx:b[2]+28*k, my=type==='rooms'?cy:horizontal?b[1]-28*k:cy;
  const grip=(handle,x,y)=>`<g data-layout-handle="${handle}" transform="translate(${x} ${y})" style="cursor:${handle==='move'?'move':({w:'ew-resize',e:'ew-resize',n:'ns-resize',s:'ns-resize',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize'}[handle])}"><title>${handle==='move'?tr('拖曳移動','Drag to move'):tr('拖曳拉長／縮短','Drag to resize')}</title><circle r="${(COARSE?22:12)*k}" fill="transparent" pointer-events="all"/><rect x="${-6*k}" y="${-6*k}" width="${12*k}" height="${12*k}" rx="${2*k}" fill="${handle==='move'?'#fff':'#b5653a'}" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="all"/>${handle==='move'?`<path d="M${-4*k} 0H${4*k}M0 ${-4*k}V${4*k}" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`:''}</g>`;
  return `<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.15)" stroke="#b5653a" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none"/>`
    +handles.map(([h,x,y])=>grip(h,x,y)).join('')+grip('move',mx,my)
    +`<text x="${cx}" y="${b[3]+25*k}" text-anchor="middle" font-size="${12*k}" fill="#b5653a" stroke="#fff" stroke-width="${3*k}" paint-order="stroke" pointer-events="none">${lengthValue(b[2]-b[0])} × ${lengthText(b[3]-b[1])}</text>`;
}
// Deltas always use the gesture's original box, so repeated pointer events cannot accumulate drift.
function layoutDragPatch(box,handle,dx,dy,{fine=false,axisLock=false}={}) {
  const step=fine?1:10, round=n=>Math.round(n/step)*step, clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  dx=round(dx); dy=round(dy);
  let [x,y,right,bottom]=box;
  if(handle==='move') {
    if(axisLock){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}
    return {x:clamp(x+dx,-50000,50000),y:clamp(y+dy,-50000,50000),width:right-x,depth:bottom-y};
  }
  if(handle.includes('w'))x=clamp(x+dx,Math.max(-50000,right-50000),Math.min(50000,right-10));
  if(handle.includes('e'))right=clamp(right+dx,x+10,x+50000);
  if(handle.includes('n'))y=clamp(y+dy,Math.max(-50000,bottom-50000),Math.min(50000,bottom-10));
  if(handle.includes('s'))bottom=clamp(bottom+dy,y+10,y+50000);
  return {x,y,width:right-x,depth:bottom-y};
}
function beginLayoutDrag(e,p,type,id,handle='move') {
  openLayoutEditor(type,id);
  const selected=layoutSelection(), item=deriveLayout(state)[type][selected.index];
  if(!item || item.hidden)return;
  drag={kind:'layout',type,id:selected.id,handle,box:layoutBox(item,type),start:p,sx:e.clientX,sy:e.clientY,pid:e.pointerId,before:snap(),moved:false};
  svg.setPointerCapture(e.pointerId); e.preventDefault();
}
function previewLayoutDrag(e,p) {
  if(e.pointerId!==drag.pid)return;
  if(!drag.moved && Math.hypot(e.clientX-drag.sx,e.clientY-drag.sy)<TAP)return;
  drag.moved=true;
  const patch=layoutDragPatch(drag.box,drag.handle,p.x-drag.start.x,p.y-drag.start.y,{fine:e.altKey,axisLock:e.shiftKey});
  setLayoutEdit(drag.type,drag.id,patch);
  syncLayoutGeometry(); renderRooms(); renderWalls(); renderOpenings(); renderLabels(); renderDims(); renderSel(); updateHeader();
  // Keep the form mounted while dragging; rebuild it once when the gesture finishes.
  for(const [key,value] of Object.entries(patch)) {
    const input=$(`#layoutForm [name="${key}"]`); if(input)input.value=lengthValue(value);
  }
}
function layoutEntryMarker() {
  const entry=DOORS.find(d=>d.entry); if(!entry) return '';
  const [x0,y0,x1,y1]=entry.rect, horizontal=entry.c[0]!==0;
  const x=(x0+x1)/2,y=(y0+y1)/2;
  const path=horizontal?`M${x} ${y0-850}V${y0-100}M${x-150} ${y0-300}L${x} ${y0-100}L${x+150} ${y0-300}`:`M${x0-850} ${y}H${x0-100}M${x0-300} ${y-150}L${x0-100} ${y}L${x0-300} ${y+150}`;
  return `<path d="${path}" fill="none" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${horizontal?x-350:x0-850}" y="${horizontal?y0-950:y-200}" font-size="200" fill="#b5653a">${tr('入戶','Entry')}</text>`;
}
