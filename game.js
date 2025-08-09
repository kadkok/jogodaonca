// Jogo da Onça 3D — versão melhorada
import * as THREE from 'https://unpkg.com/three@0.164.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.164.0/examples/jsm/controls/OrbitControls.js';
import { WebGPURenderer } from 'https://unpkg.com/three@0.164.0/examples/jsm/renderers/WebGPURenderer.js';
import { RoomEnvironment } from 'https://unpkg.com/three@0.164.0/examples/jsm/environments/RoomEnvironment.js';

export function initGameUI({ autostart } = {}) {
  const el = (id) => document.getElementById(id);
  const toast = (msg) => { const t=el('toast'); if(!t) return; t.textContent=msg; t.style.opacity=1; clearTimeout(t._to); t._to=setTimeout(()=>t.style.opacity=0, 2000); };
  const fps = (()=>{ const label = el('fps'); let last=performance.now(), frames=0; return ()=>{ frames++; const now=performance.now(); if(now-last>=500){ const fps=Math.round(frames*1000/(now-last)); if(label) label.textContent=`${fps} FPS`; frames=0; last=now; } }; })();

  // ===== State =====
  const state = { turn:'J', jaguar:null, dogs:new Set(), captured:0, selectedPiece:null, pieceAt:new Map(), mode:'local', room:null, bot:{ enabled:false, side:'C', level:'medium' }, chain:{ active:false } };

  // ===== Scene/Renderer =====
  let renderer, scene, camera, controls;
  const canvasSize = { w: innerWidth, h: innerHeight };
  async function makeRenderer(){ if('gpu' in navigator){ try{ const r=new WebGPURenderer({ antialias:true, alpha:false }); r.setSize(canvasSize.w, canvasSize.h, false); r.setAnimationLoop(tick); return r; }catch{} } const r=new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' }); r.setPixelRatio(Math.min(devicePixelRatio,2)); r.setSize(canvasSize.w, canvasSize.h, false); r.setAnimationLoop(tick); return r; }

  // Audio
  let AC; function initAudio(){ if(AC) return; AC = new (window.AudioContext||window.webkitAudioContext)(); }
  function beep(kind='move'){ try{ initAudio(); }catch{} if(!AC) return; const o=AC.createOscillator(), g=AC.createGain(); o.type='sine'; const map={move:[480,.08],capture:[320,.16],error:[140,.12],win:[700,.28]}; const [f,d]=map[kind]||map.move; o.frequency.value=f; g.gain.value=0.07; o.connect(g).connect(AC.destination); const t=AC.currentTime; o.start(t); o.stop(t+d); }

  // Build scene
  scene=new THREE.Scene(); scene.fog=new THREE.Fog(0x0a0a0a,18,45);
  camera=new THREE.PerspectiveCamera(55, canvasSize.w/canvasSize.h, .1, 200); camera.position.set(7,10,14);
  (async()=>{
    renderer=await makeRenderer(); document.body.appendChild(renderer.domElement);
    controls=new OrbitControls(camera, renderer.domElement); controls.enableDamping=true; controls.target.set(2,0,2.2);
    const pmrem=new THREE.PMREMGenerator(renderer); scene.environment=pmrem.fromScene(new RoomEnvironment(renderer), .05).texture;
    const floor=new THREE.Mesh(new THREE.CylinderGeometry(30,30,.25,64), new THREE.MeshStandardMaterial({ color:0x111111, roughness:.9 })); floor.position.y=-.13; scene.add(floor);
    scene.add(new THREE.HemisphereLight(0xffffff,0x080808,.6)); const dir=new THREE.DirectionalLight(0xffffff,.65); dir.position.set(10,15,10); scene.add(dir);
    buildBoard(); placeInitial(); wireUI(); applyAutostart(autostart);
  })();

  // ===== Graph (31 nodes) =====
  const squareNodes=[]; for(let z=0; z<5; z++) for(let x=0; x<5; x++) squareNodes.push([x,z]);
  const triangleNodes=[ [1.5,4.5],[2.5,4.5], [1.75,5],[2,5],[2.25,5], [2,5.5] ];
  const nodes=[...squareNodes,...triangleNodes];
  const idx=(x,z)=> nodes.findIndex(n=> Math.abs(n[0]-x)<1e-6 && Math.abs(n[1]-z)<1e-6);
  const edges=new Map(); const addEdge=(a,b)=>{ if(a<0||b<0||a===b) return; if(!edges.has(a)) edges.set(a,new Set()); if(!edges.has(b)) edges.set(b,new Set()); edges.get(a).add(b); edges.get(b).add(a); };
  for(let z=0; z<5; z++) for(let x=0; x<5; x++){ const a=idx(x,z); [[x+1,z],[x-1,z],[x,z+1],[x,z-1]].forEach(([nx,nz])=>{ if(nx>=0&&nx<5&&nz>=0&&nz<5) addEdge(a, idx(nx,nz)); }); }
  const quads=[[0,0],[2,0],[0,2],[2,2]]; for(const [qx,qz] of quads){ addEdge(idx(qx,qz),idx(qx+1,qz+1)); addEdge(idx(qx+1,qz),idx(qx,qz+1)); addEdge(idx(qx+1,qz+1),idx(qx+2,qz+2)); addEdge(idx(qx+2,qz+1),idx(qx+1,qz+2)); addEdge(idx(qx,qz+1),idx(qx+1,qz+2)); addEdge(idx(qx+1,qz+1),idx(qx+2,qz)); }
  const c20=idx(2,4); const tA=idx(1.5,4.5), tB=idx(2.5,4.5), tC=idx(1.75,5), tD=idx(2,5), tE=idx(2.25,5), tF=idx(2,5.5);
  [ [c20,idx(1,4)], [c20,idx(3,4)], [c20,tA], [c20,tB], [tA,tC], [tA,tD], [tB,tD], [tB,tE], [tC,tD], [tD,tE], [tC,tF], [tD,tF], [tE,tF] ].forEach(([a,b])=>addEdge(a,b));

  // ===== Visuals =====
  const boardGroup=new THREE.Group(); scene.add(boardGroup);
  const piecesGroup=new THREE.Group(); scene.add(piecesGroup);
  const dots=[];
  const metalMat=(hex, rough=.15)=> new THREE.MeshPhysicalMaterial({ color:hex, metalness:1, roughness:rough, envMapIntensity:1, reflectivity:1, clearcoat:.9, clearcoatRoughness:.1 });
  const dogMat=metalMat(0xbfc6cf,.18), jagMat=metalMat(0xc7992f,.12);
  const pieceGeo=new THREE.CylinderGeometry(.28,.28,.18,48); const topBevel=new THREE.SphereGeometry(.27,48,32,0,Math.PI*2,0,Math.PI/2);
  function makePiece(isJag){ const g=new THREE.Group(); const body=new THREE.Mesh(pieceGeo, isJag?jagMat:dogMat); const cap=new THREE.Mesh(topBevel, isJag?jagMat:dogMat); cap.position.y=.09; g.add(body,cap); const s=new THREE.Sprite(new THREE.SpriteMaterial({ color:0xffffff, opacity:.9 })); s.scale.set(.25,.25,1); s.position.set(0,.2,0); s.material.map=(()=>{ const cvs=document.createElement('canvas'); cvs.width=cvs.height=128; const ctx=cvs.getContext('2d'); ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=6; ctx.beginPath(); ctx.arc(64,64,46,0,Math.PI*2); ctx.stroke(); ctx.font='bold 54px system-ui'; ctx.fillStyle='white'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(isJag?'J':'C',64,66); const tex=new THREE.CanvasTexture(cvs); tex.anisotropy=8; return tex; })(); g.add(s); return g; }

  const START={ jaguar: idx(2,2), dogs:[ idx(0,0),idx(1,0),idx(2,0),idx(3,0),idx(4,0), idx(0,1),idx(1,1),idx(2,1),idx(3,1),idx(4,1), idx(0,2),idx(4,2), idx(1,2), idx(3,2) ] };

  function buildBoard(){ const base=new THREE.Mesh(new THREE.BoxGeometry(9.2,.4,11.2), new THREE.MeshPhysicalMaterial({ metalness:0, roughness:.6, clearcoat:.6, color:0x1a1a1a })); base.position.set(2,-.2,2.4); boardGroup.add(base);
    const lineMat=new THREE.MeshPhysicalMaterial({ color:0xd0d0d0, metalness:1, roughness:.25, reflectivity:1, clearcoat:.9, clearcoatRoughness:.15 });
    const tube=(a,b)=>{ const vA=new THREE.Vector3(nodes[a][0],.01,nodes[a][1]); const vB=new THREE.Vector3(nodes[b][0],.01,nodes[b][1]); const path=new THREE.LineCurve3(vA,vB); const geom=new THREE.TubeGeometry(path,1,.03,8,false); const mesh=new THREE.Mesh(geom,lineMat); boardGroup.add(mesh); };
    for(const [a,set] of edges) for(const b of set) if(a<b) tube(a,b);
    const dotGeo=new THREE.SphereGeometry(.07,24,16); const dotMat=new THREE.MeshStandardMaterial({ color:0xaaaaaa, metalness:.4, roughness:.4 });
    nodes.forEach(([x,z],i)=>{ const d=new THREE.Mesh(dotGeo, dotMat.clone()); d.position.set(x,.06,z); d.userData={ i }; boardGroup.add(d); dots.push(d); });
  }

  function nodeWorldPos(i){ const n=nodes[i]; return new THREE.Vector3(n[0], .1, n[1]); }
  async function animateMove(piece, toIndex, ms=230){ const from=piece.position.clone(); const to=nodeWorldPos(toIndex); const t0=performance.now(); return new Promise(res=>{ const step=(now)=>{ const k=Math.min(1,(now-t0)/ms); piece.position.lerpVectors(from,to,k); if(k<1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }); }
  async function movePieceToNode(piece, nodeIndex, instant=false){ if(instant) piece.position.copy(nodeWorldPos(nodeIndex)); else await animateMove(piece, nodeIndex); piece.userData.node=nodeIndex; }

  function updateTurnText(){ const t=el('turn'); if(!t) return; t.textContent = `Vez: ${state.turn==='J'?'Onça':'Cachorros'}${state.bot.enabled?` | Bot: ${state.bot.side==='J'?'Onça':'Cachorros'} (${state.bot.level})`:''}${state.chain.active?' | Capturas em cadeia':''}`; }

  function placeInitial(){ for(const obj of [...piecesGroup.children]) piecesGroup.remove(obj); state.pieceAt.clear(); state.dogs.clear(); state.captured=0; state.turn='J'; state.chain.active=false;
    const pj=makePiece(true); piecesGroup.add(pj); movePieceToNode(pj, START.jaguar, true); state.jaguar=START.jaguar; state.pieceAt.set(START.jaguar, pj);
    for(const d of START.dogs){ const pc=makePiece(false); piecesGroup.add(pc); movePieceToNode(pc, d, true); state.dogs.add(d); state.pieceAt.set(d, pc); }
    updateTurnText(); maybeBot();
  }

  const raycaster=new THREE.Raycaster(); const mouse=new THREE.Vector2();
  const isAdjacent=(a,b)=> edges.get(a)?.has(b);

  const selectOutline=new THREE.Mesh(new THREE.TorusGeometry(.34,.03,12,36), new THREE.MeshStandardMaterial({ color:0x66ccff, metalness:.4, roughness:.3 })); selectOutline.rotation.x=-Math.PI/2; selectOutline.visible=false; scene.add(selectOutline);
  function pick(ev){ const rect=renderer.domElement.getBoundingClientRect(); mouse.x=((ev.clientX-rect.left)/rect.width)*2-1; mouse.y=-((ev.clientY-rect.top)/rect.height)*2+1; raycaster.setFromCamera(mouse, camera); return raycaster.intersectObjects([...piecesGroup.children, ...dots], true)[0]?.object; }

  renderer?.domElement.addEventListener('pointerdown', async (ev)=>{ if(state.bot.enabled && state.turn===state.bot.side) return; if(AC && AC.state==='suspended') AC.resume(); const hit=pick(ev); if(!hit) return;
    let obj=hit; while(obj && obj.parent && obj.parent!==scene && obj.parent!==piecesGroup) obj=obj.parent;
    if(obj && obj.parent===piecesGroup){ const isJag=(obj.userData.node===state.jaguar); if((state.turn==='J' && isJag) || (state.turn==='C' && state.dogs.has(obj.userData.node))){ state.selectedPiece=obj; selectOutline.visible=true; selectOutline.position.copy(obj.position).add(new THREE.Vector3(0,0.02,0)); return; } return; }
    const d=dots.find(dd=>dd===hit || hit?.parent===dd); if(state.selectedPiece && d){ const ok=await tryMove(state.selectedPiece, d.userData.i); if(ok){ selectOutline.visible=false; state.selectedPiece=null; } }
  });

  function jaguarCapturesFrom(pos, s=state){ const caps=[]; for(const n of edges.get(pos)||[]){ if(!s.dogs.has(n)) continue; const dir=[nodes[n][0]-nodes[pos][0], nodes[n][1]-nodes[pos][1]]; const landing=idx(nodes[n][0]+dir[0], nodes[n][1]+dir[1]); if(landing>=0 && isAdjacent(n,landing) && !s.pieceAt.has(landing)) caps.push({ mid:n, to:landing }); } return caps; }
  function jaguarHasMoves(s=state){ const J=s.jaguar; for(const n of edges.get(J)||[]){ if(!s.pieceAt.has(n)) return true; if(s.dogs.has(n)){ const dir=[nodes[n][0]-nodes[J][0], nodes[n][1]-nodes[J][1]]; const landing=idx(nodes[n][0]+dir[0], nodes[n][1]+dir[1]); if(landing>=0 && isAdjacent(n,landing) && !s.pieceAt.has(landing)) return true; } } return false; }
  function checkEnd(){ if(state.captured>=5){ toast('Fim: Onça capturou 5. Vitória da Onça!'); beep('win'); return true; } if(!jaguarHasMoves()){ toast('Fim: Onça imobilizada. Vitória dos Cachorros!'); beep('win'); return true; } return false; }

  async function doCapture(piece, from, mid, landing, sync=true){ const dogPiece=state.pieceAt.get(mid); if(dogPiece){ piecesGroup.remove(dogPiece); state.pieceAt.delete(mid); state.dogs.delete(mid); } await movePieceToNode(piece, landing); state.pieceAt.delete(from); state.pieceAt.set(landing, piece); state.jaguar=landing; state.captured++; beep('capture'); if(sync) syncMove({type:'capture', from, mid, to:landing}); const more=jaguarCapturesFrom(state.jaguar); if(more.length>0){ state.chain.active=true; updateTurnText(); return 'chain-continue'; } state.chain.active=false; state.turn='C'; updateTurnText(); return 'done'; }

  async function tryMove(piece, targetNode, sync=true){ const isJaguar=(piece===state.pieceAt.get(state.jaguar)); const from=piece.userData.node; if(from===targetNode) return false;
    if(state.pieceAt.has(targetNode)){ if(!isJaguar){ beep('error'); return false; } for(const mid of edges.get(from)||[]){ if(!state.dogs.has(mid)) continue; const dir=[nodes[mid][0]-nodes[from][0], nodes[mid][1]-nodes[from][1]]; const landing=idx(nodes[mid][0]+dir[0], nodes[mid][1]+dir[1]); if(landing===targetNode && landing>=0 && !state.pieceAt.has(landing) && isAdjacent(from,mid) && isAdjacent(mid,landing)){ const r=await doCapture(piece, from, mid, landing, sync); if(!checkEnd() && r==='done') maybeBot(); return true; } } beep('error'); return false; }
    if(!isAdjacent(from,targetNode)){ beep('error'); return false; }
    if(isJaguar && state.chain.active){ beep('error'); return false; }
    if(state.pieceAt.has(targetNode)) return false; state.pieceAt.delete(from); state.pieceAt.set(targetNode,piece); await movePieceToNode(piece, targetNode); if(isJaguar) state.jaguar=targetNode; else { state.dogs.delete(from); state.dogs.add(targetNode); } state.turn=(state.turn==='J')?'C':'J'; beep('move'); updateTurnText(); if(sync) syncMove({type:'move', from, to:targetNode}); if(!checkEnd()) maybeBot(); return true; }

  // Multiplayer mock
  function uid(){ return Math.random().toString(36).slice(2,7).toUpperCase(); }
  let realtime={ publish:()=>{}, subscribe:()=>{} };
  function setupRealtime(){ realtime.publish=(room,data)=>{ localStorage.setItem('onca:'+room, JSON.stringify({ t:Date.now(), data })); }; realtime.subscribe=(room,cb)=>{ window.addEventListener('storage',(e)=>{ if(e.key==='onca:'+room && e.newValue){ try{ const {data}=JSON.parse(e.newValue); cb(data);}catch{} } }); }; }
  function syncMove(msg){ if(state.mode!=='mp' || !state.room) return; realtime.publish(state.room, msg); }
  function listenMoves(){ realtime.subscribe(state.room, async (msg)=>{ if(!msg) return; if(msg.type==='reset'){ placeInitial(); return; } if(msg.type==='move'){ const piece=state.pieceAt.get(msg.from); if(!piece) return; await tryMove(piece, msg.to, false); return; } if(msg.type==='capture'){ const piece=state.pieceAt.get(msg.from); if(!piece) return; await doCapture(piece, msg.from, msg.mid, msg.to, false); checkEnd(); return; } }); }

  // BOT (melhorado)
  function cloneMini(s){ return { turn:s.turn, jaguar:s.jaguar, dogs:new Set([...s.dogs]), captured:s.captured, pieceAt:new Map(s.pieceAt) }; }
  function applyMove(s, mv){ if(mv.side==='J'){ if(mv.captureMid!=null){ s.pieceAt.delete(mv.captureMid); s.dogs.delete(mv.captureMid); s.captured++; } const piece=s.pieceAt.get(mv.from); if(piece){ s.pieceAt.delete(mv.from); s.pieceAt.set(mv.to, piece); } s.jaguar=mv.to; const more=jaguarCapturesFrom(s.jaguar, s); if(mv.forceChain && more.length>0){ s.turn='J'; } else { s.turn='C'; } } else { const piece=s.pieceAt.get(mv.from); if(piece){ s.pieceAt.delete(mv.from); s.pieceAt.set(mv.to, piece); } s.dogs.delete(mv.from); s.dogs.add(mv.to); s.turn='J'; } return s; }
  function legalMovesFor(side, s){ const mvs=[]; if(side==='J'){ const J=s.jaguar; const caps=jaguarCapturesFrom(J, s); if(caps.length){ for(const c of caps) mvs.push({side:'J', from:J, to:c.to, captureMid:c.mid, forceChain:true}); } else { for(const n of edges.get(J)||[]) if(!s.pieceAt.has(n)) mvs.push({side:'J', from:J, to:n}); } } else { for(const from of s.dogs) for(const n of edges.get(from)||[]) if(!s.pieceAt.has(n)) mvs.push({side:'C', from, to:n}); } return mvs; }
  function evalState(s){ const material=s.captured*145; const mobility=( ()=>{ const J=s.jaguar; let free=0,caps=0; for(const n of edges.get(J)||[]){ if(!s.pieceAt.has(n)) free++; else if(s.dogs.has(n)){ const dir=[nodes[n][0]-nodes[J][0], nodes[n][1]-nodes[J][1]]; const landing=idx(nodes[n][0]+dir[0], nodes[n][1]+dir[1]); if(landing>=0 && isAdjacent(n,landing) && !s.pieceAt.has(landing)) caps++; } } return free*6 + caps*24; })(); let dogSafety=0; for(const d of s.dogs){ if((edges.get(s.jaguar)||new Set()).has(d)){ const dir=[nodes[d][0]-nodes[s.jaguar][0], nodes[d][1]-nodes[s.jaguar][1]]; const landing=idx(nodes[d][0]+dir[0], nodes[d][1]+dir[1]); if(landing>=0 && isAdjacent(d,landing) && !s.pieceAt.has(landing)) dogSafety -= 26; } } const jagMob=( ()=>{ let m=0; for(const n of edges.get(s.jaguar)||[]) if(!s.pieceAt.has(n)) m++; return m; })(); const encirclement=-Math.max(0, 4-jagMob)*10; return material + mobility + dogSafety + encirclement; }
  function minimax(s, depth, alpha, beta, maximizing){ if(depth===0 || !jaguarHasMoves(s) || s.captured>=5) return { score: evalState(s) }; if(maximizing){ let best={ score:-Infinity }; const mvs=legalMovesFor('J', s); for(const mv of mvs){ const ns=cloneMini(s); applyMove(ns, mv); const nextDepth=(mv.captureMid!=null && jaguarCapturesFrom(ns.jaguar, ns).length>0)? depth : depth-1; const r=minimax(ns, nextDepth, alpha, beta, false); if(r.score>best.score){ best={ score:r.score, mv }; } alpha=Math.max(alpha, r.score); if(beta<=alpha) break; } return best; } else { let best={ score:Infinity }; const mvs=legalMovesFor('C', s); for(const mv of mvs){ const ns=cloneMini(s); applyMove(ns, mv); const r=minimax(ns, depth-1, alpha, beta, true); if(r.score<best.score){ best={ score:r.score, mv }; } beta=Math.min(beta, r.score); if(beta<=alpha) break; } return best; } }
  function chooseBotMove(){ const side=state.bot.side; const level=state.bot.level; const moves=legalMovesFor(side, state); if(moves.length===0) return null; if(level==='easy') return moves[Math.floor(Math.random()*moves.length)]; if(level==='medium'){ let best=null, bestScore=(side==='J'?-Infinity:Infinity); for(const mv of moves){ const s=cloneMini(state); applyMove(s, mv); const sc=evalState(s); if(side==='J'){ if(sc>bestScore){ bestScore=sc; best=mv; } } else { if(sc<bestScore){ bestScore=sc; best=mv; } } } return best||moves[0]; } const depth=5; if(side==='J'){ const res=minimax(cloneMini(state), depth, -Infinity, Infinity, true); return res.mv||moves[0]; } else { const res=minimax(cloneMini(state), depth, -Infinity, Infinity, false); return res.mv||moves[0]; } }
  async function performBotMove(){ const mv=chooseBotMove(); if(!mv) return; if(mv.side==='J'){ const piece=state.pieceAt.get(state.jaguar); if(mv.captureMid!=null){ await doCapture(piece, mv.from, mv.captureMid, mv.to); if(state.chain.active){ while(state.chain.active && !checkEnd()){ const caps=jaguarCapturesFrom(state.jaguar); if(!caps.length){ state.chain.active=false; break; } const follow=chooseBotMove(); if(!follow || follow.side!=='J' || follow.captureMid==null){ const c=caps[0]; await doCapture(piece, state.jaguar, c.mid, c.to); } else { await doCapture(piece, follow.from, follow.captureMid, follow.to); } } if(!checkEnd()){ state.turn='C'; updateTurnText(); maybeBot(); } } } else { await tryMove(piece, mv.to); } } else { const piece=state.pieceAt.get(mv.from); await tryMove(piece, mv.to); } }
  function maybeBot(){ if(!state.bot.enabled) return; if(state.turn===state.bot.side){ setTimeout(()=>{ performBotMove(); }, state.bot.level==='easy'?300: state.bot.level==='medium'?420:600); } }

  // UI wiring
  function wireUI(){ const localBtn=el('localBtn'), botBtn=el('botBtn'), botSide=el('botSide'), botLevel=el('botLevel'), newRoom=el('newRoom'), joinRoom=el('joinRoom'), resetBtn=el('reset');
    localBtn.onclick=()=>{ state.mode='local'; state.bot.enabled=false; placeInitial(); };
    botBtn.onclick=()=>{ state.mode='local'; state.bot.enabled=true; state.bot.side=botSide.value; state.bot.level=botLevel.value; placeInitial(); };
    botSide.onchange=()=>{ state.bot.side=botSide.value; maybeBot(); };
    botLevel.onchange=()=>{ state.bot.level=botLevel.value; };
    newRoom.onclick=()=>{ state.mode='mp'; state.bot.enabled=false; setupRealtime(); state.room=uid(); el('roomCode').value=state.room; toast('Sala criada. Compartilhe o código.'); listenMoves(); placeInitial(); };
    joinRoom.onclick=()=>{ const code=el('roomCode').value.trim().toUpperCase(); if(!code){ toast('Informe o código.'); return; } state.mode='mp'; state.bot.enabled=false; setupRealtime(); state.room=code; toast('Entrou na sala '+code); listenMoves(); placeInitial(); };
    resetBtn.onclick=()=>{ placeInitial(); syncMove({type:'reset'}); };
    addEventListener('resize', ()=>{ canvasSize.w=innerWidth; canvasSize.h=innerHeight; camera.aspect=canvasSize.w/canvasSize.h; camera.updateProjectionMatrix(); renderer.setSize(canvasSize.w, canvasSize.h, false); });
  }

  function applyAutostart(autostart){ const q=new URLSearchParams(location.search); const as={ mode:q.get('mode')||(autostart?.mode||'bot'), side:(q.get('side')||(autostart?.side||'C')).toUpperCase(), level:(q.get('level')||(autostart?.level||'medium')).toLowerCase() };
    if(as.mode==='mp'){ setupRealtime(); toast('Modo Multiplayer: gere ou digite um código.'); }
    else if(as.mode==='local'){ state.mode='local'; state.bot.enabled=false; }
    else { state.mode='local'; state.bot.enabled=true; state.bot.side=(as.side==='J'?'J':'C'); state.bot.level=(['easy','medium','hard'].includes(as.level)?as.level:'medium'); const bs=el('botSide'), bl=el('botLevel'); if(bs) bs.value=state.bot.side; if(bl) bl.value=state.bot.level; }
    placeInitial();
    setTimeout(()=>{ toast(`Você é ${state.bot.enabled && state.bot.side==='J' ? 'os Cachorros 🐕' : 'a Onça 🐆'}. Clique numa peça, depois num ponto ligado. A Onça sempre começa.`); }, 220);
  }

  function tick(){ controls.update(); renderer.render(scene, camera); fps(); }
}
