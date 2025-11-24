// Sound System
class SoundManager {
    constructor() {
        this.enabled = false;
        this.sounds = {
            shoot: new Audio('shoot.mp3'),
            hit: new Audio('hit.mp3'),
            die: new Audio('die.mp3'),
            eat: new Audio('eat.mp3')
        };
        for (let key in this.sounds) {
            this.sounds[key].volume = 0.3;
        }
    }
    
    play(name) {
        if (!this.enabled || !this.sounds[name]) return;
        const s = this.sounds[name].cloneNode();
        s.volume = 0.3;
        s.play().catch(e => {}); 
    }
}
const sfx = new SoundManager();

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const CLIENT_VERSION = "2.0.0";
let SERVER_VERSION = "14.8.8";
let socket = null;

let HWID = localStorage.getItem('shuterok_hwid');
if (!HWID) {
    HWID = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('shuterok_hwid', HWID);
}
document.getElementById('d-hwid').innerText = `HWID: ${HWID.substring(0, 10)}...`;

const settings = {
    hq: true, names: true, minimap: true, audio: false,
    autoReload: false,
    physicsMode: 2, // 0 = no physics, 1 = old, 2 = new
    debug: { show: true, fps: true, ping: true, tps: true, walls: false, pl: true, food: false, ver: true, hwid: false, ac: true }
};

const isTouchCapable = (('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0)
    || ('ontouchstart' in window)
    || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
const savedMob = localStorage.getItem('force_mobile');
const isMob = savedMob !== null ? (savedMob === 'true') : isTouchCapable;

if (document.getElementById('set-mob')) document.getElementById('set-mob').checked = isMob;
if (document.getElementById('set-audio')) document.getElementById('set-audio').checked = false;
if (document.getElementById('set-auto-reload')) document.getElementById('set-auto-reload').checked = settings.autoReload;

// Ensure mobile controls are shown only when mobile mode is enabled
document.querySelectorAll('.mobile-ctrl').forEach(e => e.style.display = isMob ? '' : 'none');
const mobileUpEl = document.getElementById('mobile-upgrades');
if (mobileUpEl) mobileUpEl.style.display = isMob ? 'flex' : 'none';

let meId=null, mapSize=4000, players={}, bullets=[], food=[], walls=[];
let cam={x:0, y:0}, input={angle:0, move:false}, mouseIsDown = false;
let chatOpen = false;

let fps = 60, frames = 0, lastTime = performance.now();
let ping = 0;

window.toggleSettings = (show) => {
    document.getElementById('settings-menu').style.display = show ? 'flex' : 'none';
    if (!show) {
        settings.hq = document.getElementById('set-hq').checked;
        settings.names = document.getElementById('set-names').checked;
        settings.minimap = document.getElementById('set-mini').checked;
        settings.audio = document.getElementById('set-audio').checked;
        sfx.enabled = settings.audio;
        settings.autoReload = !!document.getElementById('set-auto-reload') && document.getElementById('set-auto-reload').checked;

        settings.debug.show = document.getElementById('dbg-main').checked;
        settings.debug.fps = document.getElementById('dbg-fps').checked;
        settings.debug.ping = document.getElementById('dbg-ping').checked;
        settings.debug.tps = document.getElementById('dbg-tps').checked;
        settings.debug.walls = document.getElementById('dbg-walls').checked;
        settings.debug.pl = document.getElementById('dbg-pl').checked;
        settings.debug.food = document.getElementById('dbg-food').checked;
        settings.debug.ver = document.getElementById('dbg-ver').checked;
        settings.debug.hwid = document.getElementById('dbg-hwid').checked;
        settings.debug.ac = document.getElementById('dbg-ac').checked;

        // physics mode selector (0=no,1=old,2=new)
        if (document.getElementById('set-physics')) {
            settings.physicsMode = Number(document.getElementById('set-physics').value) || settings.physicsMode;
            recreateBodiesForMode();
        }

        updateDebugVisibility();
        const mob = document.getElementById('set-mob').checked;
        if(mob !== isMob) { localStorage.setItem('force_mobile', mob); location.reload(); }
    }
};

function updateDebugVisibility() {
    const p = document.getElementById('debug-panel');
    p.style.display = settings.debug.show ? 'block' : 'none';
    
    const map = {
        'd-fps': settings.debug.fps, 'd-ping': settings.debug.ping,
        'd-tps': settings.debug.tps, 'd-walls': settings.debug.walls,
        'd-pl': settings.debug.pl, 'd-food': settings.debug.food,
        'd-ver': settings.debug.ver, 'd-hwid': settings.debug.hwid, 'd-ac': settings.debug.ac
    };
    for (let id in map) {
        document.getElementById(id).style.display = map[id] ? 'block' : 'none';
    }
}
updateDebugVisibility();

// Physics mode UI init (if present)
if (document.getElementById('set-physics')) {
    document.getElementById('set-physics').value = String(settings.physicsMode);
}

async function loadServers() {
    const listDiv = document.getElementById('server-list');
    listDiv.innerHTML = 'Загрузка...';
    
    try {
        // const res = await fetch('https://kitsastudioofficial.github.io/shuterok.io/server-list.json');
        const res = await fetch('http://localhost:3001/server-list.json');
        const servers = await res.json();
        
        listDiv.innerHTML = '';
        if (servers.length === 0) {
             listDiv.innerHTML = '<div style="color:yellow">Список серверов пустой!</div>';
        }

        servers.forEach(srv => {
            const btn = document.createElement('div');
            btn.className = 'server-item';
            btn.innerHTML = `
                <div class="sv-name">${srv.name} (${srv.region || '??'})</div>
                <div class="sv-desc">${srv.desc}</div>
                <div class="sv-ip">${srv.ip}</div>
            `;
            btn.onclick = () => connectToServer(srv.ip);
            listDiv.appendChild(btn);
        });
    } catch (e) {
        console.error("Server list error:", e);
        listDiv.innerHTML = '<div style="color:red">Ошибка загрузки списка серверов.</div>';
    }
}

// Recreate bodies when physics mode changes
function recreateBodiesForMode() {
    for (let id in players) {
        if (players[id]) players[id].body = new SoftBody(players[id].r, players[id].col, settings.physicsMode);
    }
}

function connectToServer(url) {
    const serverList = document.getElementById('server-list');
    serverList.innerHTML = '<div style="color:#2ecc71; font-weight:bold; font-size:18px;">ПОДКЛЮЧЕНИЕ...</div>';

    if (socket) socket.disconnect();

    socket = io(url, {
        path: '/secure/v1/ws',
        query: { hwid: HWID },
        transports: ['websocket', 'polling'] 
    });

    setupSocketEvents();

    const connectionTimeout = setTimeout(() => {
        if (!socket.connected) {
            console.error("Connection attempt timed out. Reverting to server list.");
            alert('Не удалось подключиться к серверу (Timeout).');
            if (socket) socket.disconnect();
            loadServers();
        }
    }, 10000); 

    socket.__timeout = connectionTimeout;
}

loadServers();

function setupSocketEvents() {
    socket.on('connect', () => {
        if (socket.__timeout) clearTimeout(socket.__timeout);

        const nick = document.getElementById('nick').value;
        socket.emit('j', nick); 

        document.getElementById('menu').style.display = 'none';
    });

    socket.on('connect_error', (error) => {
        if (socket.__timeout) clearTimeout(socket.__timeout);

        console.error("Socket Connect Error:", error);
        alert('Критическая ошибка подключения!');
        location.reload(); 
    });

    socket.on('err', (msg) => {
        alert('Ошибка сервера: ' + msg); 
        location.reload();
    });

    
    socket.on('connect_error', () => {
        alert('Не удачное подключение');
        location.reload(); 
    });

    socket.on('err', (msg) => {
        alert('Ошибка сервера: ' + msg); 
        location.reload();
    });

    socket.on('joined', d => { 
        meId=d.id; mapSize=d.map; walls=d.walls; 
        SERVER_VERSION = d.svVal || "?";
        document.getElementById('d-ver').innerText = `C:${CLIENT_VERSION} | S:${SERVER_VERSION}`;
    });
    
    socket.on('new_round', w => { walls=w; document.getElementById('game-over').style.display='none'; players={}; });
    
    socket.on('game_over', name => {
        document.getElementById('winner-name').innerText = name;
        document.getElementById('game-over').style.display = 'flex';
    });
    
    socket.on('chat_msg', msg => {
        const box = document.getElementById('chat-msgs');
        const el = document.createElement('div');
        el.innerHTML = `<span class="msg-name">${msg.name}:</span> ${msg.text}`;
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
    });

    socket.on('s_effect', d => {
        if (!players[meId]) return;
        const dx = players[meId].x - d.x;
        const dy = players[meId].y - d.y;
        if (Math.hypot(dx, dy) < 1500) sfx.play(d.type);
    });

    setInterval(() => {
        if(socket && socket.connected) {
            const start = Date.now();
            socket.emit('ping_check', start);
        }
    }, 1000);
    socket.on('pong_check', (ts) => {
        ping = Date.now() - ts;
        document.getElementById('d-ping').innerText = `PING: ${ping}ms`;
    });

    socket.on('u', pack => {
        pack.p.forEach(srv => {
            let p = players[srv.id];
            if(!p) {
                p = players[srv.id] = { ...srv };
                p.body = new SoftBody(srv.r, srv.col, settings.physicsMode);
            } else {
                p.tx=srv.x; p.ty=srv.y; p.r=srv.r; p.hp=srv.hp; p.mHp=srv.mHp;
                p.a=srv.a; p.st=srv.st; p.pt=srv.pt; p.sc=srv.sc; p.nm=srv.nm; p.lvl=srv.lvl;
                p.col = srv.col;
                p.wp = srv.wp;
                p.wps = srv.wps;
                p.weapon = srv.wp;
                p.weapons = srv.wps;
                p.ammo = srv.ammo;
                p.mAmmo = srv.mAmmo;
                p.relTime = srv.relTime;
                if (p.body) p.body.setMode(settings.physicsMode);
                else p.body = new SoftBody(srv.r, srv.col, settings.physicsMode);
            }
        });
        for(let id in players) if(!pack.p.find(p=>p.id===id)) delete players[id];
        bullets = pack.b; food = pack.f;
        
        let t = pack.time, m = Math.floor(t/60), s = Math.floor(t%60);
        document.getElementById('timer').innerText = `${m}:${s<10?'0'+s:s}`;

        if (pack.d) {
            document.getElementById('d-tps').innerText = `S-TPS: ${pack.d.tps}`;
            document.getElementById('d-walls').innerText = `WALLS: ${pack.d.w}`;
            document.getElementById('d-pl').innerText = `PL: ${pack.d.p}`;
            document.getElementById('d-food').innerText = `FOOD: ${pack.d.f}`;
            document.getElementById('d-ac').innerText = `AC: ${pack.d.ac}`;
        }
        
        updateHUD();
    });
}

class SoftBody {
    constructor(r, c, mode = 2) {
        this.nodes = [];
        this.r = r;
        this.c = c;
        this.mode = mode; // 0=no physics,1=old,2=new
        this.count = (this.mode === 2) ? 16 : 12;
        for (let i = 0; i < this.count; i++) this.nodes.push({ x: 0, y: 0, vx: 0, vy: 0 });
    }
    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;
        this.count = (this.mode === 2) ? 16 : 12;
        this.nodes = [];
        for (let i = 0; i < this.count; i++) this.nodes.push({ x: 0, y: 0, vx: 0, vy: 0 });
    }
    update(x, y, r, a, mov) {
        this.r = r;
        if (this.mode === 0) return;
        const nodes = this.nodes;
        const cnt = this.count;
        const stiffness = (this.mode === 2) ? 0.18 : 0.1;
        const damping = (this.mode === 2) ? 0.75 : 0.8;
        const bias = (mov && this.mode === 2) ? 0.4 : ((mov) ? 0.3 : 0);
        for (let i = 0; i < cnt; i++) {
            let n = nodes[i], th = (Math.PI * 2 * i) / cnt;
            let tx = Math.cos(th) * r, ty = Math.sin(th) * r;
            if (mov) { tx -= Math.cos(a) * r * bias; ty -= Math.sin(a) * r * bias; }
            n.vx += (tx - n.x) * stiffness; n.vy += (ty - n.y) * stiffness;
            n.vx *= damping; n.vy *= damping; n.x += n.vx; n.y += n.vy;
        }
    }
    draw(ctx, x, y, a) {
        if (this.mode === 0) {
            // simple circle
            ctx.fillStyle = this.c; ctx.beginPath(); ctx.arc(x, y, this.r, 0, Math.PI * 2); ctx.fill();
            // eyes
            ctx.fillStyle = 'white';
            let off = this.r * 0.5, sz = this.r * 0.25;
            let ex1 = x + Math.cos(a - 0.6) * off, ey1 = y + Math.sin(a - 0.6) * off;
            let ex2 = x + Math.cos(a + 0.6) * off, ey2 = y + Math.sin(a + 0.6) * off;
            ctx.beginPath(); ctx.arc(ex1, ey1, sz, 0, 6.28); ctx.arc(ex2, ey2, sz, 0, 6.28); ctx.fill();
            ctx.fillStyle = 'black';
            let lx = Math.cos(a) * sz * 0.4, ly = Math.sin(a) * sz * 0.4;
            ctx.beginPath(); ctx.arc(ex1 + lx, ey1 + ly, sz / 2, 0, 6.28); ctx.arc(ex2 + lx, ey2 + ly, sz / 2, 0, 6.28); ctx.fill();
            return;
        }
        ctx.fillStyle = this.c; ctx.beginPath();
        for (let i = 0; i <= this.count; i++) {
            let n = this.nodes[i % this.count], nx = this.nodes[(i + 1) % this.count];
            let mx = (n.x + nx.x) / 2 + x, my = (n.y + nx.y) / 2 + y;
            if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(n.x + x, n.y + y, mx, my);
        }
        ctx.fill();
        ctx.fillStyle = 'white';
        let off = this.r * 0.5, sz = this.r * 0.25;
        let ex1 = x + Math.cos(a - 0.6) * off, ey1 = y + Math.sin(a - 0.6) * off;
        let ex2 = x + Math.cos(a + 0.6) * off, ey2 = y + Math.sin(a + 0.6) * off;
        ctx.beginPath(); ctx.arc(ex1, ey1, sz, 0, 6.28); ctx.arc(ex2, ey2, sz, 0, 6.28); ctx.fill();
        ctx.fillStyle = 'black';
        let lx = Math.cos(a) * sz * 0.4, ly = Math.sin(a) * sz * 0.4;
        ctx.beginPath(); ctx.arc(ex1 + lx, ey1 + ly, sz / 2, 0, 6.28); ctx.arc(ex2 + lx, ey2 + ly, sz / 2, 0, 6.28); ctx.fill();
    }
}

if (!isMob) {
    window.addEventListener('mousemove', (e) => {
        if(chatOpen || !socket) return;
        input.angle = Math.atan2(e.clientY - canvas.height/2, e.clientX - canvas.width/2);
        input.move = true; socket.emit('i', input);
    });
    window.addEventListener('mousedown', (e) => {
        if (chatOpen || !socket) return;
        // ignore clicks when focused on input fields
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        mouseIsDown = true;
        const me = players[meId];
        if (me && me.weapon !== 'minigun') {
            socket.emit('s');
        }
    });
    window.addEventListener('mouseup', () => mouseIsDown = false);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { toggleChat(); return; }
        // ignore when typing in input or chat
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (!socket) return;
        // Keybinds:
        // 0 - Default gun
        // 1 - Damage upgrade
        // 2 - Reload upgrade
        // 3 - Speed upgrade
        // 4 - HP upgrade
        // 5 - Shotgun
        // 6 - Minigun
        if (e.key === '0' || e.code === 'Digit0') buyOrEquip('default');
        if (e.key === '1' || e.code === 'Digit1') socket.emit('u', 'dmg');
        if (e.key === '2' || e.code === 'Digit2') socket.emit('u', 'rel');
        if (e.key === '3' || e.code === 'Digit3') socket.emit('u', 'spd');
        if (e.key === '4' || e.code === 'Digit4') socket.emit('u', 'hp');
        if (e.key === '5' || e.code === 'Digit5') buyOrEquip('shotgun');
        if (e.key === '6' || e.code === 'Digit6') buyOrEquip('minigun');
        // reload key
        if (e.key.toLowerCase() === 'r') socket.emit('reload');
    });
} else {
    const joy = document.getElementById('joy-zone'), knob = document.getElementById('joy-knob');
    let jId = null;
    joy.ontouchstart=e=>{e.preventDefault(); jId=e.changedTouches[0].identifier; moveJoy(e.changedTouches[0]);}
    joy.ontouchmove=e=>{e.preventDefault(); for(let t of e.changedTouches) if(t.identifier===jId) moveJoy(t);}
    joy.ontouchend=e=>{e.preventDefault(); knob.style.transform=''; input.move=false; socket && socket.emit('i', input);}
    document.getElementById('fire-btn').ontouchstart=e=>{e.preventDefault(); socket && socket.emit('s');}
    function moveJoy(t) {
        const r=joy.getBoundingClientRect(), dx=t.clientX-r.left-60, dy=t.clientY-r.top-60;
        const ang=Math.atan2(dy,dx), d=Math.min(40, Math.hypot(dx,dy));
        knob.style.transform=`translate(${Math.cos(ang)*d}px, ${Math.sin(ang)*d}px)`;
        input.angle=ang; input.move=true; socket && socket.emit('i', input);
    }
}

function toggleChat() {
    const inp = document.getElementById('chat-input');
    chatOpen = !chatOpen;
    inp.style.display = chatOpen ? 'block' : 'none';
    if(chatOpen) inp.focus();
    else {
        if(inp.value && socket) socket.emit('c', inp.value);
        inp.value = '';
    }
}

window.buyOrEquip = (wp) => {
    if (!socket) return;
    const me = players[meId];
    if (me && !me.weapons?.includes(wp)) {
        socket.emit('buy_weapon', wp);
    } else {
        socket.emit('equip_weapon', wp);
    }
};

window.buyWeapon = (wp) => socket && socket.emit('buy_weapon', wp);

window.upgrade = t => socket && socket.emit('u', t);

function updateHUD() {
    const me = players[meId];
    if(!me) return;
    document.getElementById('pts').innerText = me.pt;
    document.getElementById('upgrades').classList.remove('hidden');
    ['dmg','rel','spd','hp'].forEach((k,i) => {
        let v = me.st[['dmg','rel','spd','hp'][i]] || 0;
        document.getElementById('b-'+k).style.width = Math.min(v/8*100,100)+'%';
    });
    document.getElementById('b-default').style.width = me.weapons?.includes('default') ? '100%' : '0%';
    document.getElementById('b-shotgun').style.width = me.weapons?.includes('shotgun') ? '100%' : '0%';
    document.getElementById('b-minigun').style.width = me.weapons?.includes('minigun') ? '100%' : '0%';
    const ammoText = me.relTime > 0 ? `Reloading: ${Math.ceil(me.relTime/1000)}s` : `${me.ammo}/${me.mAmmo}`;
    document.getElementById('ammo-status').innerText = `Ammo: ${ammoText}`;
    // Auto-reload if enabled and empty and not currently reloading
    if (settings.autoReload && socket && me.ammo <= 0 && me.relTime <= 0) {
        socket.emit('reload');
    }
    let list = Object.values(players).sort((a,b)=>b.sc-a.sc).slice(0,5);
    document.getElementById('leaderboard').innerHTML = list.map((p,i)=>`${i+1}. ${p.nm}`).join('<br>');
}




function draw() {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
        document.getElementById('d-fps').innerText = `FPS: ${fps}`;
    }

    ctx.fillStyle = '#111'; ctx.fillRect(0,0,canvas.width,canvas.height);
    
    let me = players[meId];
    if(me) {
        for(let id in players) {
            let p = players[id];
            if(p.tx!==undefined) { p.x+=(p.tx-p.x)*0.15; p.y+=(p.ty-p.y)*0.15; }
            if(settings.hq) p.body.update(p.x,p.y,p.r,p.a,(id===meId?input.move:true));
        }
        if (mouseIsDown) {
            const me = players[meId];
            if (me && me.weapon === 'minigun') {
                socket.emit('s');
            }
        }
        cam.x = me.x - canvas.width/2;
        cam.y = me.y - canvas.height/2;
    }

    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    ctx.strokeStyle='#222'; ctx.beginPath();
    for(let i=0;i<=mapSize;i+=100){ctx.moveTo(i,0);ctx.lineTo(i,mapSize);ctx.moveTo(0,i);ctx.lineTo(mapSize,i);}
    ctx.stroke();
    
    ctx.fillStyle = '#333';
    ctx.shadowBlur = 10; ctx.shadowColor = 'black';
    walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));
    ctx.shadowBlur = 0;
    
    ctx.strokeStyle='#444'; ctx.lineWidth=10; ctx.strokeRect(0,0,mapSize,mapSize);

    food.forEach(f => {
        ctx.fillStyle=f.color; ctx.beginPath();
        if(f.type==='spike') {
            for(let i=0;i<16;i++) { let r=(i%2===0)?f.r:f.r/2, a=(Math.PI*2*i)/16; ctx.lineTo(f.x+Math.cos(a)*r, f.y+Math.sin(a)*r); }
            ctx.fill();
        } else { ctx.arc(f.x,f.y,f.r,0,6.28); ctx.fill(); }
    });

    for(let id in players) {
        let p = players[id];
        if(settings.hq) p.body.draw(ctx,p.x,p.y,p.a);
        else { 
            ctx.fillStyle=p.col; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fill(); 
            ctx.fillStyle='white'; ctx.beginPath(); ctx.arc(p.x+Math.cos(p.a)*p.r*0.5, p.y+Math.sin(p.a)*p.r*0.5, p.r*0.3, 0, 6.28); ctx.fill();
        }
        if(settings.names) { ctx.fillStyle='white'; ctx.font='bold 14px Arial'; ctx.textAlign='center'; ctx.fillText(p.nm, p.x, p.y-p.r-12); }
        ctx.fillStyle='#c0392b'; ctx.fillRect(p.x-20, p.y+p.r+10, 40, 5);
        ctx.fillStyle='#2ecc71'; ctx.fillRect(p.x-20, p.y+p.r+10, 40*(p.hp/p.mHp), 5);
    }

    ctx.fillStyle='#ff0'; bullets.forEach(b => {ctx.beginPath(); ctx.arc(b.x,b.y,6,0,6.28); ctx.fill();});
    ctx.restore();

    if(me && settings.minimap) {
        const sz=150, pad=10, mx=canvas.width-sz-pad, my=canvas.height-sz-pad, sc=sz/mapSize;
        ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(mx,my,sz,sz);
        ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.strokeRect(mx,my,sz,sz);
        ctx.fillStyle='#555'; walls.forEach(w => ctx.fillRect(mx+w.x*sc, my+w.y*sc, w.w*sc, w.h*sc));
        for(let id in players) {
            let p = players[id];
            ctx.fillStyle = (id === meId) ? '#2ecc71' : '#e74c3c';
            ctx.beginPath(); ctx.arc(mx+p.x*sc, my+p.y*sc, (id===meId?4:3), 0, 6.28); ctx.fill();
        }
    }
    requestAnimationFrame(draw);
}

canvas.width = window.innerWidth; canvas.height = window.innerHeight;
window.onresize=()=>{canvas.width=window.innerWidth; canvas.height=window.innerHeight;}
draw();
