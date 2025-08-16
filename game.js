const BASE_CANVAS_W = 800, BASE_CANVAS_H = 500;
const MIN_CANVAS_W = 320, MIN_CANVAS_H = 200;
const MAX_CANVAS = 100;
const REBIRTHS_PER_BOARD = 10;

// --- DOM ---
const playerScoreElem = document.getElementById('player-score');
const aiScoreElem = document.getElementById('ai-score');
const pointMultElem = document.getElementById('point-mult');
const modifiersBar = document.getElementById('modifiers-bar');
const boostModal = document.getElementById('boost-modal');
const boostContent = document.getElementById('boost-content');
const introScreen = document.getElementById('intro-screen');
const startButton = document.getElementById('start-btn');
const newGameButton = document.getElementById('new-game-btn');
const loadGameButton = document.getElementById('load-game-btn');
const boardsContainer = document.getElementById('pong-boards');
const titlebar = document.getElementById('titlebar');
const skillsBar = document.getElementById('skills-bar');

// --- GAME STATE ---
let boards = [];
let globalState = {
    rebirths: 0,
    rebirthBoosts: { // retained for compatibility; not used for picking anymore
        'slower-ball': 0,
        'slower-ai': 0,
        'larger-ball': 0,
        'larger-paddle': 0,
        'smaller-ai-paddle': 0
    },
    unlockedSkills: { // NEW: skills locked by default
        slowTime: false,
        slowAI: false,
        spawnBalls: false,
        bigPaddle: false,
        barrier: false,
        magnet: false
    },
    pointMultiplier: 1,
    modifiers: {},
    lastPlayerScoreMod: 0,
    lastAIScoreMod: 0
};
let isPaused = true;
let tempMessage = "";
let tempMsgTimeout = null;

// --- MODIFIERS ---
const modifierTypes = [
    {id: 'addBall', icon: 'fas fa-plus-circle', name: 'Extra Ball'},
    {id: 'biggerBall', icon: 'fas fa-circle', name: 'Larger Ball'},
    {id: 'smallerBall', icon: 'fas fa-circle-notch', name: 'Smaller Ball'},
    {id: 'fasterBall', icon: 'fas fa-bolt', name: 'Faster Ball'},
    {id: 'slowerBall', icon: 'fas fa-hourglass-half', name: 'Slower Ball'},
    {id: 'changeColor', icon: 'fas fa-palette', name: 'Change Color'},
    {id: 'rgbColor', icon: 'fas fa-rainbow', name: 'RGB Color'},
    {id: 'largerPaddle', icon: 'fas fa-arrows-alt-v', name: 'Larger Paddle'},
    {id: 'smallerPaddle', icon: 'fas fa-compress-alt', name: 'Smaller Paddle'},
    {id: 'smallerAIPaddle', icon: 'fas fa-arrow-down', name: 'Smaller AI Paddle'},
    {id: 'largerAIPaddle', icon: 'fas fa-arrow-up', name: 'Larger AI Paddle'},
    {id: '2xBall', icon: 'fas fa-clone', name: '2x Ball'},
    {id: 'goldBall', icon: 'fas fa-medal', name: 'Gold Ball'},
    {id: 'diamondBall', icon: 'fas fa-gem', name: 'Diamond Ball'}
];
function resetModifiers() {
    globalState.modifiers = {};
    modifierTypes.forEach(m=>globalState.modifiers[m.id]=0);
}
resetModifiers();

// --- SAVE/LOAD ---
function saveGame() {
    const save = {
        global: {
            ...globalState,
            // Persist minimal skill runtime info
            playerSkillsLastUsed: Object.fromEntries(Object.entries(playerSkills).map(([id,s])=>[id,s.lastUsed]))
        },
        boards: boards.map(b=>({
            playerScore: b.state.playerScore,
            aiScore: b.state.aiScore,
            balls: b.state.balls.map(ball=>({...ball})),
            PADDLE_HEIGHT: b.state.PADDLE_HEIGHT,
            AI_PADDLE_HEIGHT: b.state.AI_PADDLE_HEIGHT,
            BALL_SIZE: b.state.BALL_SIZE,
            BALL_SPEED: b.state.BALL_SPEED,
            ballColor: b.state.ballColor,
            bgColor: b.state.bgColor,
            useRGB: b.state.useRGB,
            playerY: b.state.playerY,
            aiY: b.state.aiY,
            goldBallPending: b.state.goldBallPending || 0,
            diamondBallPending: b.state.diamondBallPending || 0
        }))
    };
    localStorage.setItem('ultimate-pong-save', JSON.stringify(save));
}
function loadGame() {
    const save = localStorage.getItem('ultimate-pong-save');
    if (!save) {
        showTempMsg("No save found!");
        return false;
    }
    const data = JSON.parse(save);
    Object.assign(globalState, data.global);
    resetBoards(data.boards.length);
    data.boards.forEach((b,i)=>{ Object.assign(boards[i].state, b); });
    // Restore skill last-used stamps
    if (data.global.playerSkillsLastUsed) {
        Object.entries(data.global.playerSkillsLastUsed).forEach(([id, t])=>{
            if (playerSkills[id]) playerSkills[id].lastUsed = t;
        });
    }
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
    showTempMsg("Game loaded!");
    isPaused = false;
    introScreen.classList.add('hidden');
    return true;
}
function newGame() {
    globalState.rebirths = 0;
    resetModifiers();
    globalState.rebirthBoosts = {'slower-ball':0,'slower-ai':0,'larger-ball':0,'larger-paddle':0,'smaller-ai-paddle':0};
    globalState.unlockedSkills = { slowTime:false, slowAI:false, spawnBalls:false, bigPaddle:false, barrier:false, magnet:false };
    globalState.pointMultiplier = 1;
    globalState.lastPlayerScoreMod = 0;
    globalState.lastAIScoreMod = 0;
    resetBoards(1);
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
    showTempMsg("New game started!");
    isPaused = false;
    introScreen.classList.add('hidden');
    saveGame();
}

// --- BOARD ENGINE ---
function resetBoards(count) {
    boardsContainer.innerHTML = "";
    boards = [];
    let grid = boardLayout(count);
    for (let i=0; i<count; ++i) {
        let canvas = document.createElement('canvas');
        let sz = getBoardSize(grid, i);
        canvas.width = sz.w; canvas.height = sz.h;
        canvas.className = 'pong-canvas';
        canvas.tabIndex = -1;
        boardsContainer.appendChild(canvas);
        let ctx = canvas.getContext('2d');
        boards.push({
            canvas,
            ctx,
            state: boardInitialState(sz.w, sz.h)
        });
    }
}
function getActiveBoardCount() {
    return Math.min(1 + Math.floor(globalState.rebirths / REBIRTHS_PER_BOARD), MAX_CANVAS);
}
function boardLayout(count) {
    let cols = Math.ceil(Math.sqrt(count));
    let rows = Math.ceil(count / cols);
    return {cols, rows};
}
function getBoardSize(grid, idx) {
    let w = Math.max(BASE_CANVAS_W / grid.cols, MIN_CANVAS_W);
    let h = Math.max(BASE_CANVAS_H / grid.rows, MIN_CANVAS_H);
    return {w: Math.round(w), h: Math.round(h)};
}
function showTempMsg(msg) {
    tempMessage = msg;
    if (tempMsgTimeout) clearTimeout(tempMsgTimeout);
    tempMsgTimeout = setTimeout(()=>{ tempMessage=""; }, 1800);
}
function boardInitialState(width, height) {
    return {
        width, height,
        playerY: (height-100)/2,
        aiY: (height-100)/2,
        PADDLE_WIDTH: 10,
        PADDLE_HEIGHT: 100,
        AI_PADDLE_HEIGHT: 100,
        BALL_SIZE: 12,
        BALL_SPEED: 5,
        PLAYER_X: 20,
        AI_X: width-30,
        PADDLE_SPEED: 6,
        AI_SPEED: 4,
        ballColor: "#fff",
        bgColor: "#111",
        useRGB: false,
        balls: [makeBall(width, height, 5, 12, "#fff")],
        playerScore: 0,
        aiScore: 0,
        goldBallPending: 0,
        diamondBallPending: 0
    };
}
function makeBall(width, height, speed=5, size=12, color="#fff", isGold=false, isDiamond=false) {
    let dirX = Math.random() > 0.5 ? 1 : -1;
    let dirY = (Math.random() - 0.5) * 1.5;
    return {
        x: width/2-size/2,
        y: height/2-size/2,
        speedX: speed * dirX,
        speedY: 7*dirY,
        size,
        color,
        isGold,
        isDiamond
    }
}

// --- UI ---
function updateScore() {
    // Sum scores across all boards for global consistency
    let totalPlayerScore = boards.reduce((sum, b) => sum + b.state.playerScore, 0);
    let totalAiScore = boards.reduce((sum, b) => sum + b.state.aiScore, 0);
    playerScoreElem.textContent = totalPlayerScore.toFixed(2);
    aiScoreElem.textContent = totalAiScore.toFixed(2);
    pointMultElem.textContent = globalState.pointMultiplier > 1.0001 ? `x${globalState.pointMultiplier.toFixed(3)} pts` : "";
}
function updateModifiersBar() {
    // To prevent flashing, update existing elements if possible instead of full clear
    const existingMods = {};
    modifiersBar.querySelectorAll('.modifier').forEach(el => {
        const id = el.dataset.id;
        if (id) existingMods[id] = el;
    });
    modifiersBar.innerHTML = '';
    modifierTypes.forEach(type => {
        if (globalState.modifiers[type.id] > 0) {
            let div = existingMods[type.id] || document.createElement('div');
            let count = globalState.modifiers[type.id];
            div.dataset.id = type.id;
            div.className = 'modifier' + (existingMods[type.id] ? ' no-anim' : '');
            div.innerHTML = `<i class="${type.icon}"></i>${type.name} <span class="mod-count">${count}</span>`;
            modifiersBar.appendChild(div);
        }
    });
    if (globalState.rebirths > 0) {
        let rebirthDiv = existingMods['rebirth'] || document.createElement('div');
        rebirthDiv.dataset.id = 'rebirth';
        rebirthDiv.className = 'modifier' + (existingMods['rebirth'] ? ' no-anim' : '');
        rebirthDiv.innerHTML = `<i class="fas fa-infinity"></i> Rebirth <span class="mod-count">${globalState.rebirths}</span>`;
        modifiersBar.appendChild(rebirthDiv);
    }
    if (globalState.pointMultiplier > 1.0001) {
        let pmDiv = existingMods['pointMult'] || document.createElement('div');
        pmDiv.dataset.id = 'pointMult';
        pmDiv.className = 'modifier' + (existingMods['pointMult'] ? ' no-anim' : '');
        pmDiv.innerHTML = `<i class="fas fa-coins"></i> x${globalState.pointMultiplier.toFixed(3)}`;
        modifiersBar.appendChild(pmDiv);
    }
    adjustModifierWidths();
}

function adjustModifierWidths() {
    const items = modifiersBar.querySelectorAll('.modifier');
    items.forEach(el => {
        el.style.width = 'auto';
        const w = el.scrollWidth + 6;
        el.style.width = w + 'px';
    });
}

// --- SKILLS ---
const skillTypes = [
    {
        id: 'slowTime',
        name: 'Slow Time',
        icon: 'fas fa-hourglass-half',
        desc: 'Slow all balls for 8s (CD 30s)',
        cooldown: 30,
        duration: 8,
        activate: function() {
            for (let b of boards) for (let ball of b.state.balls) { ball.speedX *= 0.35; ball.speedY *= 0.35; }
            setTimeout(() => {
                for (let b of boards) for (let ball of b.state.balls) { ball.speedX /= 0.35; ball.speedY /= 0.35; }
            }, 8000);
        }
    },
    {
        id: 'slowAI',
        name: 'Slow AI',
        icon: 'fas fa-robot',
        desc: 'Slow AI paddle for 10s (CD 30s)',
        cooldown: 30,
        duration: 10,
        activate: function() {
            for (let b of boards) b.state.AI_SPEED *= 0.5;
            setTimeout(() => { for (let b of boards) b.state.AI_SPEED *= 2; }, 10000);
        }
    },
    {
        id: 'spawnBalls',
        name: 'Multiball (x3)',
        icon: 'fas fa-bowling-ball',
        desc: 'Spawn 3 balls (CD 12s)',
        cooldown: 12,
        duration: 0,
        activate: function() {
            for (let b of boards) for (let i = 0; i < 3; ++i) {
                b.state.balls.push(makeBall(b.state.width, b.state.height, b.state.BALL_SPEED, b.state.BALL_SIZE, b.state.ballColor));
            }
        }
    },
    {
        id: 'bigPaddle',
        name: 'Big Paddle',
        icon: 'fas fa-arrows-alt-v',
        desc: '1.5x Player Paddle for 12s (CD 25s)',
        cooldown: 25,
        duration: 12,
        activate: function() {
            for (let b of boards) b.state.PADDLE_HEIGHT *= 1.5;
            setTimeout(() => { for (let b of boards) b.state.PADDLE_HEIGHT /= 1.5; }, 12000);
        }
    },
    {
        id: 'barrier',
        name: 'Barrier',
        icon: 'fas fa-shield-alt',
        desc: 'Temporary left-wall shield 8s (CD 28s)',
        cooldown: 28,
        duration: 8,
        activate: function() {
            skillEffects.barrierUntil = Date.now()/1000 + 8;
        }
    },
    {
        id: 'magnet',
        name: 'Magnet Paddle',
        icon: 'fas fa-magnet',
        desc: 'Balls curve toward your paddle 6s (CD 20s)',
        cooldown: 20,
        duration: 6,
        activate: function() {
            skillEffects.magnetUntil = Date.now()/1000 + 6;
        }
    }
];

let playerSkills = {}; // { skillId: { cooldown, lastUsed } }
function resetSkills() {
    playerSkills = {};
    skillTypes.forEach(skill => {
        playerSkills[skill.id] = { cooldown: skill.cooldown, lastUsed: -9999 };
    });
}
resetSkills();

const skillEffects = { barrierUntil: 0, magnetUntil: 0 }; // runtime effects
let hotkeyMap = {}; // {'1': 'slowTime', ...}

function recomputeHotkeys() {
    hotkeyMap = {};
    const keys = ['1','2','3','4','5','6','7','8','9'];
    const unlocked = skillTypes.filter(s => globalState.unlockedSkills[s.id]);
    unlocked.forEach((s, idx) => { if (keys[idx]) hotkeyMap[keys[idx]] = s.id; });
}

function updateSkillsBar() {
    skillsBar.innerHTML = '';
    recomputeHotkeys();
    const keys = Object.entries(hotkeyMap).map(([k,id])=>({key:k, id}));
    skillTypes.forEach(skill => {
        if (!globalState.unlockedSkills[skill.id]) return;
        const state = playerSkills[skill.id];
        const cdLeft = Math.max(0, Math.ceil(state.lastUsed + skill.cooldown - Date.now()/1000));
        const key = keys.find(x=>x.id===skill.id)?.key || '';
        const btn = document.createElement('button');
        btn.className = 'skill-btn' + (cdLeft>0 ? ' cooldown' : '');
        btn.title = skill.desc + (key ? ` [${key}]` : '');
        btn.innerHTML = `
            <i class="${skill.icon}"></i>
            <span class="skill-name">${skill.name}${skill.cooldown ? ` <span style="opacity:.85">${cdLeft>0?`(CD ${cdLeft}s)`:'(Ready)'}</span>`:''}</span>
            ${key ? `<span class="skill-key">${key}</span>`:''}
            ${cdLeft>0?`<div class="cd-overlay" style="height: ${ (cdLeft / skill.cooldown) * 100 }%;"></div>`:''}
        `;
        btn.onclick = () => tryUseSkill(skill.id);
        skillsBar.appendChild(btn);
    });
}

function tryUseSkill(skillId) {
    if (!globalState.unlockedSkills[skillId] || isPaused) return;
    const skill = skillTypes.find(s=>s.id===skillId);
    const state = playerSkills[skillId];
    const now = Date.now()/1000;
    if (!skill || !state) return;
    if (skill.cooldown && now < state.lastUsed + skill.cooldown) return;
    skill.activate();
    state.lastUsed = now;
    updateSkillsBar();
    updateModifiersBar();
}

// Update skill UI cooldown every second
setInterval(() => {
    updateSkillsBar();
}, 1000);

// --- REBIRTH: SKILL UNLOCK ONLY ---
function showPermanentBoostMenu() {
    isPaused = true;
    // Build skill unlock list for locked skills only
    const locked = skillTypes.filter(s => !globalState.unlockedSkills[s.id]);
    let html = `<h2>Rebirth Unlocked!</h2><p>Select one Skill to unlock permanently (hotkeys 1–9 for use in game).</p>`;
    html += `<div style="display:flex;flex-direction:column;gap:8px;align-items:stretch;margin-top:8px;">`;
    locked.forEach(s=>{
        html += `<button class="skill-btn" data-skill="${s.id}"><i class="${s.icon}"></i> ${s.name} — ${s.desc}</button>`;
    });
    if (locked.length === 0) {
        html += `<p>All skills unlocked! Enjoy your bonus multiplier.</p><button data-skill="__continue" class="skill-btn"><i class="fas fa-check"></i> Continue</button>`;
    }
    html += `</div>`;
    boostContent.innerHTML = html;
    boostModal.classList.remove("hidden");
    boostContent.focus();
}

boostContent.addEventListener('click', function(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    const skillId = btn.dataset.skill;
    // Always grant multiplier on rebirth
    globalState.rebirths += 1;
    globalState.pointMultiplier = Math.round(globalState.pointMultiplier*1.01*100000)/100000 || 1;

    if (skillId && skillId !== '__continue') {
        globalState.unlockedSkills[skillId] = true;
        showTempMsg(`Unlocked Skill: ${skillTypes.find(s=>s.id===skillId)?.name || skillId}!`);
    } else {
        showTempMsg(`Rebirth! +1.01x points`);
    }

    boostModal.classList.add("hidden");
    resetForRebirth();
    isPaused = false;
    updateSkillsBar();
    saveGame();
});
function applyPermanentBoost(boardIdx, boost, silent=false) {
    let b = boards[boardIdx];
    switch (boost) {
        case "slower-ball":
            for (let ball of b.state.balls) {
                ball.speedX *= 0.75;
                ball.speedY *= 0.75;
            }
            b.state.BALL_SPEED *= 0.75;
            if (!silent) showTempMsg("Rebirth: Slower Ball!");
            break;
        case "slower-ai":
            b.state.AI_SPEED *= 0.5;
            if (!silent) showTempMsg("Rebirth: Slower AI!");
            break;
        case "larger-ball":
            b.state.BALL_SIZE += 8;
            for (let ball of b.state.balls) ball.size = b.state.BALL_SIZE;
            if (!silent) showTempMsg("Rebirth: Larger Ball!");
            break;
        case "larger-paddle":
            b.state.PADDLE_HEIGHT += 36;
            if (!silent) showTempMsg("Rebirth: Larger Paddle!");
            break;
        case "smaller-ai-paddle":
            b.state.AI_PADDLE_HEIGHT = Math.max(30, b.state.AI_PADDLE_HEIGHT-36);
            if (!silent) showTempMsg("Rebirth: Smaller AI Paddle!");
            break;
    }
}
// --- REBIRTH RESET ---
function resetForRebirth() {
    resetModifiers();
    resetSkills();
    let boardCount = getActiveBoardCount();
    resetBoards(boardCount);
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
}

// --- GAME ENGINE ---
function randomColor() {
    return `hsl(${~~(Math.random()*360)}, 60%, 55%)`;
}
function rgbColor() {
    return `rgb(${Math.floor(Math.abs(Math.sin(Date.now()/900))*255)},${Math.floor(Math.abs(Math.sin(Date.now()/700))*255)},${Math.floor(Math.abs(Math.sin(Date.now()/500))*255)})`;
}
function rgbBgColor() {
    return `rgb(${Math.floor(Math.abs(Math.sin(Date.now()/1300))*60+30)},${Math.floor(Math.abs(Math.sin(Date.now()/1100))*60+30)},${Math.floor(Math.abs(Math.sin(Date.now()/900))*60+30)})`;
}
function drawTempMessage(ctx, w, h) {
    if (tempMessage) {
        ctx.font = 'bold 22px Segoe UI, Arial';
        ctx.fillStyle = '#fff8';
        ctx.textAlign = 'center';
        ctx.fillText(tempMessage, w/2, h/2);
    }
}
function drawBall(ctx, ball, useRGB=false) {
    ctx.save();
    if (ball.isGold) ctx.shadowColor="#fd0", ctx.shadowBlur=10;
    if (ball.isDiamond) ctx.shadowColor="#0ff", ctx.shadowBlur=13;
    ctx.fillStyle = ball.isGold ? "#fd0" : ball.isDiamond ? "#0ff" : (useRGB ? rgbColor() : ball.color);
    ctx.beginPath();
    ctx.arc(ball.x+ball.size/2, ball.y+ball.size/2, ball.size/2, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
    if (ball.isDiamond) {
        ctx.strokeStyle="#fff";
        ctx.lineWidth=2;
        ctx.beginPath();
        ctx.arc(ball.x+ball.size/2, ball.y+ball.size/2, ball.size/2+2, 0, Math.PI*2);
        ctx.stroke();
    }
}
function drawBoard(board) {
    let {ctx,state} = board;
    ctx.clearRect(0,0,state.width,state.height);
    ctx.fillStyle = state.useRGB ? rgbBgColor() : state.bgColor;
    ctx.fillRect(0,0,state.width,state.height);
    ctx.fillStyle="#fff";
    ctx.fillRect(state.PLAYER_X, state.playerY, state.PADDLE_WIDTH, state.PADDLE_HEIGHT);
    ctx.fillRect(state.AI_X, state.aiY, state.PADDLE_WIDTH, state.AI_PADDLE_HEIGHT);
    for (let ball of state.balls) drawBall(ctx, ball, state.useRGB);
    drawTempMessage(ctx, state.width, state.height);
}

// --- BALL PHYSICS+SCORE ---
let lastFrameTime = performance.now();
function gameloop(now) {
    let dt = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;

    if (!isPaused) {
        for (let boardIdx=0; boardIdx<boards.length; ++boardIdx) {
            let b = boards[boardIdx], s = b.state;
            if (s.goldBallPending>0) {
                let ball = makeBall(s.width,s.height,s.BALL_SPEED,s.BALL_SIZE,s.ballColor,true,false);
                s.balls.push(ball); s.goldBallPending--;
            }
            if (s.diamondBallPending>0) {
                let ball = makeBall(s.width,s.height,s.BALL_SPEED,s.BALL_SIZE,s.ballColor,false,true);
                s.balls.push(ball); s.diamondBallPending--;
            }
            for (let ball of s.balls) handleBallPhysics(boardIdx, ball, dt);
            processScore(boardIdx);
            updateAI(boardIdx);
            drawBoard(b);
        }
    } else {
        for (let board of boards) drawBoard(board);
    }
    requestAnimationFrame(gameloop);
}
function handleBallPhysics(boardIdx, ball, dt) {
    let s = boards[boardIdx].state;
    const now = Date.now()/1000;

    // Magnet effect: pull balls slightly toward player's paddle center
    if (skillEffects.magnetUntil > now && ball.x < s.width * 0.65) {
        const target = s.playerY + s.PADDLE_HEIGHT/2;
        const center = ball.y + ball.size/2;
        const dy = (target - center) * 0.004; // gentle curve
        ball.speedY += dy * (dt * 60);
    }

    ball.x += ball.speedX * dt * 60;
    ball.y += ball.speedY * dt * 60;

    if (ball.y < 0) { ball.y = 0; ball.speedY *= -1; }
    if (ball.y+ball.size > s.height) { ball.y = s.height-ball.size; ball.speedY *= -1; }

    // --- FIX: Only bounce if ball is moving toward the paddle ---
    // Player paddle collision
    if (
        ball.x <= s.PLAYER_X + s.PADDLE_WIDTH &&
        ball.x + ball.size >= s.PLAYER_X && // ensure overlap
        ball.y + ball.size >= s.playerY &&
        ball.y <= s.playerY + s.PADDLE_HEIGHT &&
        ball.speedX < 0 // only if moving left
    ) {
        ball.x = s.PLAYER_X + s.PADDLE_WIDTH;
        ball.speedX = Math.abs(ball.speedX) * 1.08; // bounce right, increase speed
        let hitPos = (ball.y + ball.size / 2) - (s.playerY + s.PADDLE_HEIGHT / 2);
        ball.speedY = hitPos * 0.23;
    }
    // AI paddle collision
    if (
        ball.x + ball.size >= s.AI_X &&
        ball.x <= s.AI_X + s.PADDLE_WIDTH && // ensure overlap
        ball.y + ball.size >= s.aiY &&
        ball.y <= s.aiY + s.AI_PADDLE_HEIGHT &&
        ball.speedX > 0 // only if moving right
    ) {
        ball.x = s.AI_X - ball.size;
        ball.speedX = -Math.abs(ball.speedX) * 1.08; // bounce left, increase speed
        let hitPos = (ball.y + ball.size / 2) - (s.aiY + s.AI_PADDLE_HEIGHT / 2);
        ball.speedY = hitPos * 0.23;
    }

    // Barrier effect: prevent scoring on the left for duration
    if (skillEffects.barrierUntil > now && ball.x < 0) {
        ball.x = 0;
        ball.speedX = Math.abs(ball.speedX); // reflect to the right
    }
}
function resetScoredBall(boardIdx, ball, scoredByPlayer) {
    let s = boards[boardIdx].state;
    ball.x = s.width/2-ball.size/2;
    ball.y = s.height/2-ball.size/2;
    ball.speedX = s.BALL_SPEED*(scoredByPlayer?-1:1)*(Math.random()>0.5?1:-1);
    ball.speedY = (Math.random()-0.5)*8;
    ball.color = s.ballColor;
    ball.isGold = false;
    ball.isDiamond = false;
}
function processScore(boardIdx) {
    let b = boards[boardIdx], s = b.state;
    let playerScored = 0, aiScored = 0;
    let ballsToRemove = [];
    for (let i=0; i<s.balls.length; ++i) {
        let ball = s.balls[i];
        let gold = ball.isGold, diamond = ball.isDiamond;
        if (ball.x < 0) {
            aiScored++;
            if (gold || diamond) ballsToRemove.push(i);
            else resetScoredBall(boardIdx, ball, false);
        }
        if (ball.x > s.width) {
            let mult = globalState.pointMultiplier;
            if (gold) mult *= 2;
            if (diamond) mult *= 3;
            playerScored += mult;
            if (gold || diamond) ballsToRemove.push(i);
            else resetScoredBall(boardIdx, ball, true);
        }
    }
    for (let i=ballsToRemove.length-1;i>=0;--i) s.balls.splice(ballsToRemove[i],1);
    if (s.balls.length===0) s.balls.push(makeBall(s.width,s.height,s.BALL_SPEED,s.BALL_SIZE,s.ballColor));
    if (playerScored>0) s.playerScore = Math.round((s.playerScore+playerScored)*100)/100;
    if (aiScored>0) s.aiScore += aiScored;
    updateScore();
    if (Math.floor(s.playerScore) !== globalState.lastPlayerScoreMod && s.playerScore > 0 && Math.floor(s.playerScore)%2===0) {
        playerModifierRoulette(boardIdx);
        globalState.lastPlayerScoreMod = Math.floor(s.playerScore);
    }
    if (s.aiScore !== globalState.lastAIScoreMod && s.aiScore > 0 && s.aiScore%2===0) {
        aiModifierRoulette(boardIdx);
        globalState.lastAIScoreMod = s.aiScore;
    }
    // Check rebirth on total player score
    if (boards.reduce((sum, b) => sum + b.state.playerScore, 0) >= 100) showPermanentBoostMenu();
}

// --- BOARD AI ---
function updateAI(boardIdx) {
    let b = boards[boardIdx], s = b.state;
    if (s.balls.length===0) return;
    let targetBall = s.balls.reduce((prev, curr)=>Math.abs(curr.x-s.AI_X)<Math.abs(prev.x-s.AI_X)?curr:prev);
    let aiCenter = s.aiY + s.AI_PADDLE_HEIGHT/2;
    if (aiCenter < targetBall.y+targetBall.size/2-12) s.aiY += s.AI_SPEED;
    else if (aiCenter > targetBall.y+targetBall.size/2+12) s.aiY -= s.AI_SPEED;
    s.aiY = Math.max(0, Math.min(s.height-s.AI_PADDLE_HEIGHT, s.aiY));
}

// --- PLAYER MODIFIERS (example; assume defined elsewhere as per original) ---
function playerModifierRoulette(boardIdx) {
    let r = Math.random()*100;
    if (r < 20)       return addBall(boardIdx);
    else if (r < 50)  return biggerBall(boardIdx);
    else if (r < 60)  return slowerBall(boardIdx);
    else if (r < 77)  return (Math.random()<0.294) ? rgbColorModifier(boardIdx) : changeColor(boardIdx);
    else if (r < 87)  return largerPaddle(boardIdx);
    else if (r < 97)  return smallerAIPaddle(boardIdx);
    else if (r < 99.9) return goldBall(boardIdx);
    else return diamondBall(boardIdx);
}

// --- AI MODIFIERS (similar placeholder) ---
function aiModifierRoulette(boardIdx) {
    let r = Math.random()*100;
    if (r < 20)       return addBall(boardIdx);
    else if (r < 50)  return smallerBall(boardIdx);
    else if (r < 60)  return fasterBall(boardIdx);
    else if (r < 77)  return (Math.random()<0.294) ? rgbColorModifier(boardIdx) : changeColor(boardIdx);
    else if (r < 87)  return smallerPaddle(boardIdx);
    else if (r < 97)  return largerAIPaddle(boardIdx);
    else if (r < 99.9) return goldBall(boardIdx);
    else return diamondBall(boardIdx);
}

// --- ADD BALL / DOUBLE / GOLD / DIAMOND (from original) ---
function addBall(boardIdx) {
    let b = boards[boardIdx];
    b.state.balls.push(makeBall(b.state.width, b.state.height, b.state.BALL_SPEED, b.state.BALL_SIZE, b.state.ballColor));
    globalState.modifiers.addBall++;
    showTempMsg("Modifier: +1 Ball!");
    updateModifiersBar();
}
function biggerBall(boardIdx) {
    let b = boards[boardIdx];
    for (let ball of b.state.balls) ball.size += 8;
    b.state.BALL_SIZE += 8;
    globalState.modifiers.biggerBall++;
    showTempMsg("Modifier: Larger Ball!");
    updateModifiersBar();
}
function smallerBall(boardIdx) {
    let b = boards[boardIdx];
    for (let ball of b.state.balls) ball.size = Math.max(8, ball.size-8);
    b.state.BALL_SIZE = Math.max(8, b.state.BALL_SIZE-8);
    globalState.modifiers.smallerBall++;
    showTempMsg("Modifier: Smaller Ball!");
    updateModifiersBar();
}
function fasterBall(boardIdx) {
    let b = boards[boardIdx];
    for (let ball of b.state.balls) {
        ball.speedX *= 1.25;
        ball.speedY *= 1.25;
    }
    b.state.BALL_SPEED *= 1.25;
    globalState.modifiers.fasterBall++;
    showTempMsg("Modifier: Faster Ball!");
    updateModifiersBar();
}
function slowerBall(boardIdx) {
    let b = boards[boardIdx];
    for (let ball of b.state.balls) {
        ball.speedX *= 0.75;
        ball.speedY *= 0.75;
    }
    b.state.BALL_SPEED *= 0.75;
    globalState.modifiers.slowerBall++;
    showTempMsg("Modifier: Slower Ball!");
    updateModifiersBar();
}
function changeColor(boardIdx) {
    let b = boards[boardIdx];
    b.state.ballColor = randomColor();
    for (let ball of b.state.balls) ball.color = b.state.ballColor;
    b.state.bgColor = randomColor();
    b.state.useRGB = false;
    globalState.modifiers.changeColor++;
    showTempMsg("Modifier: Color Change!");
    updateModifiersBar();
}
function rgbColorModifier(boardIdx) {
    let b = boards[boardIdx];
    b.state.useRGB = true;
    globalState.modifiers.rgbColor++;
    showTempMsg("Modifier: RGB Color!");
    updateModifiersBar();
}
function largerPaddle(boardIdx) {
    let b = boards[boardIdx];
    b.state.PADDLE_HEIGHT += 22;
    globalState.modifiers.largerPaddle++;
    showTempMsg("Modifier: Larger Paddle!");
    updateModifiersBar();
}
function smallerPaddle(boardIdx) {
    let b = boards[boardIdx];
    b.state.PADDLE_HEIGHT = Math.max(40, b.state.PADDLE_HEIGHT-22);
    globalState.modifiers.smallerPaddle++;
    showTempMsg("Modifier: Smaller Paddle!");
    updateModifiersBar();
}
function smallerAIPaddle(boardIdx) {
    let b = boards[boardIdx];
    b.state.AI_PADDLE_HEIGHT = Math.max(40, b.state.AI_PADDLE_HEIGHT-22);
    globalState.modifiers.smallerAIPaddle++;
    showTempMsg("Modifier: Smaller AI Paddle!");
    updateModifiersBar();
}
function largerAIPaddle(boardIdx) {
    let b = boards[boardIdx];
    b.state.AI_PADDLE_HEIGHT += 11;
    globalState.modifiers.largerAIPaddle++;
    showTempMsg("Modifier: Larger AI Paddle!");
    updateModifiersBar();
}
function goldBall(boardIdx) {
    boards[boardIdx].state.goldBallPending = (boards[boardIdx].state.goldBallPending || 0) + 1;
    globalState.modifiers.goldBall++;
    showTempMsg("Modifier: Gold Ball next!");
    updateModifiersBar();
}
function diamondBall(boardIdx) {
    boards[boardIdx].state.diamondBallPending = (boards[boardIdx].state.diamondBallPending || 0) + 1;
    globalState.modifiers.diamondBall++;
    showTempMsg("Modifier: Diamond Ball next!");
    updateModifiersBar();
}
function doubleBalls(boardIdx) {
    let b = boards[boardIdx];
    let newBalls = [];
    for (let ball of b.state.balls) {
        let copy = {...ball};
        copy.x += 5; copy.y += 5;
        newBalls.push(copy);
    }
    b.state.balls.push(...newBalls);
    globalState.modifiers['2xBall']++;
    showTempMsg("Modifier: 2x Ball!");
    updateModifiersBar();
}

// --- UI EVENTS ---
startButton.onclick = ()=>{
    newGame();
    introScreen.classList.add('hidden');
};
newGameButton.onclick = ()=>{
    if (confirm("Start new game? Progress will reset.")) {
        newGame();
        introScreen.classList.add('hidden');
    }
};
loadGameButton.onclick = ()=>{
    loadGame();
};

// --- INIT ---
function firstInit() {
    let boardsN = getActiveBoardCount();
    resetBoards(boardsN);
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
    requestAnimationFrame(gameloop);
}

// --- HARD RESET (total wipe) ---
function hardReset() {
    if (!confirm("Are you sure you want to HARD RESET? All progress will be lost!")) return;
    localStorage.removeItem('ultimate-pong-save');
    globalState = {
        rebirths: 0,
        rebirthBoosts: { 'slower-ball': 0, 'slower-ai': 0, 'larger-ball': 0, 'larger-paddle': 0, 'smaller-ai-paddle': 0 },
        unlockedSkills: { slowTime:false, slowAI:false, spawnBalls:false, bigPaddle:false, barrier:false, magnet:false },
        pointMultiplier: 1,
        modifiers: {},
        lastPlayerScoreMod: 0,
        lastAIScoreMod: 0
    };
    resetModifiers();
    resetBoards(1);
    resetSkills();
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
    showTempMsg("Hard reset done!");
    isPaused = true; // Pause after reset
    introScreen.classList.remove('hidden');
}

// --- RESET MODIFIERS AND BOARDS ---
function resetModifiersAndBoards() {
    resetModifiers();
    globalState.lastPlayerScoreMod = 0;
    globalState.lastAIScoreMod = 0;
    let boardCount = getActiveBoardCount();
    resetBoards(boardCount);
    for (let i = 0; i < boardCount; ++i) {
        boards[i].state.playerScore = 0;
        boards[i].state.aiScore = 0;
        boards[i].state.PADDLE_HEIGHT = 100;
        boards[i].state.AI_PADDLE_HEIGHT = 100;
        boards[i].state.BALL_SIZE = 12;
        boards[i].state.BALL_SPEED = 5;
        boards[i].state.ballColor = "#fff";
        boards[i].state.bgColor = "#111";
        boards[i].state.useRGB = false;
        boards[i].state.balls = [makeBall(boards[i].state.width, boards[i].state.height, 5, 12, "#fff")];
        boards[i].state.playerY = (boards[i].state.height - 100) / 2;
        boards[i].state.aiY = (boards[i].state.height - 100) / 2;
        boards[i].state.goldBallPending = 0;
        boards[i].state.diamondBallPending = 0;
    }
    updateModifiersBar();
    updateSkillsBar();
    updateScore();
    showTempMsg("Modifiers and boards reset!");
    saveGame();
}

// Touch support for mobile devices
document.addEventListener('touchmove', (e) => {
    if (isPaused) return;
    // Prevent scrolling
    e.preventDefault();
    // Use the first touch point (supports single-touch)
    let touch = e.touches[0];
    for (let board of boards) {
        const rect = board.canvas.getBoundingClientRect();
        const state = board.state;
        const targetY = touch.clientY - rect.top - state.PADDLE_HEIGHT / 2;
        state.playerY = Math.max(0, Math.min(state.height - state.PADDLE_HEIGHT, targetY));
    }
}, { passive: false });

// Event listeners for controls and skills
document.addEventListener('mousemove', (e) => {
    if (isPaused) return;
    for (let board of boards) {
        const rect = board.canvas.getBoundingClientRect();
        const state = board.state;
        const targetY = e.clientY - rect.top - state.PADDLE_HEIGHT / 2;
        state.playerY = Math.max(0, Math.min(state.height - state.PADDLE_HEIGHT, targetY));
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key in hotkeyMap && !isPaused) {
        tryUseSkill(hotkeyMap[e.key]);
    }
});

// Tab switching for intro
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab + '-tab').classList.add('active');
    });
});

// Fix buttons
document.addEventListener('DOMContentLoaded', function() {
    const resetModifiersBtn = document.getElementById('reset-modifiers-btn');
    if (resetModifiersBtn) {
        resetModifiersBtn.addEventListener('click', resetModifiersAndBoards);
    }
    
    const hardResetBtn = document.getElementById('hard-reset-btn');
    if (hardResetBtn) {
        hardResetBtn.addEventListener('click', hardReset);
    }
    
    firstInit(); // Call init after DOM ready
});
