const socket = io();
let gameState = null, myId = null;

const roomCodeEl = document.getElementById('roomCode'), score1El = document.getElementById('score1'), score2El = document.getElementById('score2');
const turnIndicatorEl = document.getElementById('turnIndicator'), playersListEl = document.getElementById('playersList');
const halfSuitsStatusEl = document.getElementById('halfSuitsStatus'), handDisplayEl = document.getElementById('handDisplay');
const gameLogEl = document.getElementById('gameLog'), notificationEl = document.getElementById('notification'), playerInfoEl = document.getElementById('playerInfo');
const askPanelEl = document.getElementById('askPanel'), targetPlayerEl = document.getElementById('targetPlayer');
const cardToAskEl = document.getElementById('cardToAsk'), askBtnEl = document.getElementById('askBtn');
const passPanelEl = document.getElementById('passPanel'), passTargetEl = document.getElementById('passTarget'), passBtnEl = document.getElementById('passBtn');
const claimPanelEl = document.getElementById('claimPanel'), claimHalfSuitEl = document.getElementById('claimHalfSuit');
const showClaimBtnEl = document.getElementById('showClaimBtn'), claimAssignmentsEl = document.getElementById('claimAssignments');

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

socket.on('connect', () => {
    myId = socket.id;
    const roomCode = new URLSearchParams(window.location.search).get('room');
    if (!roomCode) { window.location.href = '/'; return; }
    socket.emit('rejoinGame', roomCode);
});

socket.on('disconnect', () => { window.location.href = '/'; });

socket.on('gameState', (state) => {
    if (!state.gameStarted) { window.location.href = '/'; return; }
    gameState = state;
    renderGame();
});

function renderGame() {
    if (!gameState) return;
    roomCodeEl.textContent = gameState.roomCode;
    score1El.textContent = gameState.scores[0];
    score2El.textContent = gameState.scores[1];
    
    const me = gameState.players[gameState.myIndex];
    if (me && playerInfoEl) playerInfoEl.innerHTML = `<span class="player-name">${me.name}</span> <span class="team-badge team-${me.team + 1}-bg">Team ${me.team + 1}</span>`;
    
    const currentPlayer = gameState.players[gameState.currentTurn], isMyTurn = gameState.currentTurn === gameState.myIndex;
    turnIndicatorEl.textContent = isMyTurn ? "Your Turn!" : `${currentPlayer.name}'s Turn`;
    turnIndicatorEl.parentElement.classList.toggle('your-turn', isMyTurn);
    
    renderPlayers(); renderHalfSuitsStatus(); renderHand(); renderActionPanels(); renderLog();
}

function renderPlayers() {
    playersListEl.innerHTML = '';
    gameState.players.forEach((p, i) => {
        const li = document.createElement('li');
        li.className = `team-${p.team + 1}`;
        if (i === gameState.currentTurn) li.classList.add('current-turn');
        if (p.id === myId) li.classList.add('you');
        const nameSpan = document.createElement('span'); nameSpan.textContent = p.name + (p.id === myId ? ' (You)' : '');
        const countSpan = document.createElement('span'); countSpan.className = 'card-count'; countSpan.textContent = p.cardCount;
        li.appendChild(nameSpan); li.appendChild(countSpan); playersListEl.appendChild(li);
    });
}

function renderHalfSuitsStatus() {
    halfSuitsStatusEl.innerHTML = '';
    gameState.halfSuits.forEach(hs => {
        const div = document.createElement('div'); div.className = 'hs-item';
        const nameSpan = document.createElement('span'); nameSpan.textContent = hs.display;
        const statusSpan = document.createElement('span');
        if (gameState.claimedSuits.includes(hs.name)) { div.classList.add('claimed-1'); statusSpan.textContent = '✓'; }
        else if (gameState.middleSuits.includes(hs.name)) { div.classList.add('middle'); statusSpan.textContent = '○'; }
        else statusSpan.textContent = '—';
        div.appendChild(nameSpan); div.appendChild(statusSpan); halfSuitsStatusEl.appendChild(div);
    });
}

function renderHand() {
    handDisplayEl.innerHTML = '';
    if (!gameState.hand.length) { handDisplayEl.innerHTML = '<p style="color: #7a8ba3;">You have no cards</p>'; return; }
    const groups = {};
    gameState.hand.forEach(c => { const hs = getHalfSuit(c); if (!groups[hs]) groups[hs] = []; groups[hs].push(c); });
    Object.entries(groups).forEach(([hsName, cards]) => {
        const groupDiv = document.createElement('div'); groupDiv.className = 'half-suit-group';
        const hsInfo = gameState.halfSuits.find(h => h.name === hsName);
        const label = document.createElement('div'); label.className = 'half-suit-label'; label.textContent = hsInfo ? hsInfo.display : hsName;
        groupDiv.appendChild(label);
        const cardsRow = document.createElement('div'); cardsRow.className = 'cards-row';
        cards.forEach(card => {
            const cardEl = document.createElement('div'); cardEl.className = `card ${card.suit}`;
            cardEl.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${SUIT_SYMBOLS[card.suit]}</span>`;
            cardEl.onclick = () => selectCardToAsk(card);
            cardsRow.appendChild(cardEl);
        });
        groupDiv.appendChild(cardsRow); handDisplayEl.appendChild(groupDiv);
    });
}

function selectCardToAsk(card) {
    const hs = getHalfSuit(card);
    for (let i = 0; i < cardToAskEl.options.length; i++) {
        const [r, s] = cardToAskEl.options[i].value.split('_');
        if (s === card.suit && getHalfSuit({ rank: r, suit: s }) === hs) { cardToAskEl.selectedIndex = i; break; }
    }
}

function renderActionPanels() {
    const isMyTurn = gameState.currentTurn === gameState.myIndex, hasCards = gameState.hand.length > 0;
    const myTeam = gameState.myTeam, currentTurnTeam = gameState.players[gameState.currentTurn].team, canClaim = myTeam === currentTurnTeam;
    
    if (hasCards && isMyTurn) {
        askPanelEl.classList.remove('disabled', 'hidden'); passPanelEl.classList.add('hidden');
        targetPlayerEl.innerHTML = '';
        gameState.opponents.forEach(o => { const opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.name; targetPlayerEl.appendChild(opt); });
        cardToAskEl.innerHTML = '';
        gameState.validAsks.forEach(c => { const opt = document.createElement('option'); opt.value = c.id; opt.textContent = `${c.rank}${SUIT_SYMBOLS[c.suit]}`; cardToAskEl.appendChild(opt); });
        askBtnEl.disabled = !gameState.opponents.length || !gameState.validAsks.length;
    } else if (!hasCards && isMyTurn) {
        askPanelEl.classList.add('hidden'); passPanelEl.classList.remove('hidden');
        passTargetEl.innerHTML = '';
        gameState.players.forEach(p => { if (p.team === myTeam && p.id !== myId && p.cardCount > 0) { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; passTargetEl.appendChild(opt); } });
        passBtnEl.disabled = !passTargetEl.options.length;
    } else { askPanelEl.classList.add('disabled'); passPanelEl.classList.add('hidden'); }
    
    if (canClaim) {
        claimPanelEl.classList.remove('disabled');
        claimHalfSuitEl.innerHTML = '';
        gameState.halfSuits.forEach(hs => { if (!gameState.claimedSuits.includes(hs.name) && !gameState.middleSuits.includes(hs.name)) { const opt = document.createElement('option'); opt.value = hs.name; opt.textContent = hs.display; claimHalfSuitEl.appendChild(opt); } });
        showClaimBtnEl.disabled = !claimHalfSuitEl.options.length;
    } else claimPanelEl.classList.add('disabled');
    if (!canClaim) claimAssignmentsEl.classList.add('hidden');
}

function renderLog() {
    gameLogEl.innerHTML = '';
    const entries = [...gameState.log].reverse();
    let askCount = 0;
    entries.forEach(entry => {
        const div = document.createElement('div'); div.className = `log-entry ${entry.type}`;
        const isAsk = entry.type === 'success' || entry.type === 'fail';
        if (isAsk) { askCount++; div.textContent = askCount > 2 ? entry.message.replace(/for .+? (✓|✗)/, 'for ??? $1') : entry.message; }
        else div.textContent = entry.message;
        gameLogEl.appendChild(div);
    });
}

function getHalfSuit(card) { return `${['2','3','4','5','6','7'].includes(card.rank) ? 'low' : 'high'}_${card.suit}`; }

function showNotification(msg, type = 'info') {
    notificationEl.textContent = msg; notificationEl.className = `notification ${type}`; notificationEl.classList.remove('hidden');
    setTimeout(() => notificationEl.classList.add('hidden'), 3000);
}

askBtnEl.addEventListener('click', () => {
    const targetId = targetPlayerEl.value, cardId = cardToAskEl.value;
    if (!targetId || !cardId) return showNotification('Select a player and card', 'error');
    socket.emit('askCard', { targetPlayerId: targetId, cardId }, (r) => { if (!r.success) showNotification(r.error, 'error'); else if (r.got) showNotification('Got the card! Go again!', 'success'); });
});

passBtnEl.addEventListener('click', () => {
    const targetId = passTargetEl.value;
    if (!targetId) return showNotification('Select a teammate', 'error');
    socket.emit('passTurn', { targetPlayerId: targetId }, (r) => { if (!r.success) showNotification(r.error, 'error'); });
});

showClaimBtnEl.addEventListener('click', () => {
    const hsName = claimHalfSuitEl.value; if (!hsName) return;
    const hsInfo = gameState.halfSuits.find(h => h.name === hsName); if (!hsInfo) return;
    claimAssignmentsEl.innerHTML = ''; claimAssignmentsEl.classList.remove('hidden');
    hsInfo.ranks.forEach(rank => {
        const row = document.createElement('div'); row.className = 'claim-row';
        const label = document.createElement('span'); label.className = `claim-card-label ${hsInfo.suit}`; label.textContent = `${rank}${SUIT_SYMBOLS[hsInfo.suit]}`;
        const select = document.createElement('select'); select.className = 'claim-player-select'; select.dataset.cardId = `${rank}_${hsInfo.suit}`;
        gameState.players.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.name; select.appendChild(opt); });
        row.appendChild(label); row.appendChild(select); claimAssignmentsEl.appendChild(row);
    });
    const submitBtn = document.createElement('button'); submitBtn.className = 'btn btn-claim'; submitBtn.textContent = 'Submit Claim'; submitBtn.onclick = submitClaim;
    claimAssignmentsEl.appendChild(submitBtn);
});

function submitClaim() {
    const hsName = claimHalfSuitEl.value, assignments = {};
    claimAssignmentsEl.querySelectorAll('.claim-player-select').forEach(s => { assignments[s.dataset.cardId] = s.value; });
    socket.emit('makeClaim', { halfSuit: hsName, assignments }, (r) => {
        if (!r.success) showNotification(r.error, 'error');
        else { claimAssignmentsEl.classList.add('hidden'); showNotification(r.result, r.result.includes('correctly') ? 'success' : 'error'); }
    });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.matches('select') && !askPanelEl.classList.contains('disabled') && !askPanelEl.classList.contains('hidden')) askBtnEl.click(); });
