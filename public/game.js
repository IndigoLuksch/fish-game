const socket = io();

// Game state
let gameState = null;
let myId = null;

// DOM elements
const roomCodeEl = document.getElementById('roomCode');
const score1El = document.getElementById('score1');
const score2El = document.getElementById('score2');
const turnIndicatorEl = document.getElementById('turnIndicator');
const playersListEl = document.getElementById('playersList');
const halfSuitsStatusEl = document.getElementById('halfSuitsStatus');
const handDisplayEl = document.getElementById('handDisplay');
const gameLogEl = document.getElementById('gameLog');
const notificationEl = document.getElementById('notification');

// Ask panel
const askPanelEl = document.getElementById('askPanel');
const targetPlayerEl = document.getElementById('targetPlayer');
const cardToAskEl = document.getElementById('cardToAsk');
const askBtnEl = document.getElementById('askBtn');

// Pass panel
const passPanelEl = document.getElementById('passPanel');
const passTargetEl = document.getElementById('passTarget');
const passBtnEl = document.getElementById('passBtn');

// Claim panel
const claimPanelEl = document.getElementById('claimPanel');
const claimHalfSuitEl = document.getElementById('claimHalfSuit');
const showClaimBtnEl = document.getElementById('showClaimBtn');
const claimAssignmentsEl = document.getElementById('claimAssignments');

// Suit symbols
const SUIT_SYMBOLS = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
};

// Connect and get ID
socket.on('connect', () => {
    myId = socket.id;
    
    // Get room code from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    
    if (!roomCode) {
        window.location.href = '/';
        return;
    }
    
    // Emit rejoin to get game state
    socket.emit('rejoinGame', roomCode);
});

// Redirect to lobby if not in game
socket.on('disconnect', () => {
    window.location.href = '/';
});

// Handle game state updates
socket.on('gameState', (state) => {
    if (!state.gameStarted) {
        window.location.href = '/';
        return;
    }
    
    gameState = state;
    // Don't reset myId here - it's already set
    renderGame();
});

function renderGame() {
    if (!gameState) return;
    
    // Header
    roomCodeEl.textContent = gameState.roomCode;
    score1El.textContent = gameState.scores[0];
    score2El.textContent = gameState.scores[1];
    
    // Turn indicator
    const currentPlayer = gameState.players[gameState.currentTurn];
    const isMyTurn = gameState.currentTurn === gameState.myIndex;
    
    if (isMyTurn) {
        turnIndicatorEl.textContent = "Your Turn!";
        turnIndicatorEl.parentElement.classList.add('your-turn');
    } else {
        turnIndicatorEl.textContent = `${currentPlayer.name}'s Turn`;
        turnIndicatorEl.parentElement.classList.remove('your-turn');
    }
    
    // Players list
    renderPlayers();
    
    // Half-suits status
    renderHalfSuitsStatus();
    
    // Hand
    renderHand();
    
    // Action panels
    renderActionPanels();
    
    // Game log
    renderLog();
}

function renderPlayers() {
    playersListEl.innerHTML = '';
    
    gameState.players.forEach((player, idx) => {
        const li = document.createElement('li');
        li.className = `team-${player.team + 1}`;
        
        if (idx === gameState.currentTurn) {
            li.classList.add('current-turn');
        }
        if (player.id === myId) {
            li.classList.add('you');
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = player.name + (player.id === myId ? ' (You)' : '');
        
        const countSpan = document.createElement('span');
        countSpan.className = 'card-count';
        countSpan.textContent = player.cardCount;
        
        li.appendChild(nameSpan);
        li.appendChild(countSpan);
        playersListEl.appendChild(li);
    });
}

function renderHalfSuitsStatus() {
    halfSuitsStatusEl.innerHTML = '';
    
    gameState.halfSuits.forEach(hs => {
        const div = document.createElement('div');
        div.className = 'hs-item';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = hs.display;
        
        const statusSpan = document.createElement('span');
        
        if (gameState.claimedSuits.includes(hs.name)) {
            // Find which team claimed it based on log (simplified: just mark as claimed)
            div.classList.add('claimed-1'); // Could track actual team
            statusSpan.textContent = '✓';
        } else if (gameState.middleSuits.includes(hs.name)) {
            div.classList.add('middle');
            statusSpan.textContent = '○';
        } else {
            statusSpan.textContent = '—';
        }
        
        div.appendChild(nameSpan);
        div.appendChild(statusSpan);
        halfSuitsStatusEl.appendChild(div);
    });
}

function renderHand() {
    handDisplayEl.innerHTML = '';
    
    if (gameState.hand.length === 0) {
        handDisplayEl.innerHTML = '<p style="color: #888;">You have no cards</p>';
        return;
    }
    
    // Group by half-suit
    const groups = {};
    gameState.hand.forEach(card => {
        const hs = getHalfSuit(card);
        if (!groups[hs]) groups[hs] = [];
        groups[hs].push(card);
    });
    
    Object.entries(groups).forEach(([hsName, cards]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'half-suit-group';
        
        const hsInfo = gameState.halfSuits.find(h => h.name === hsName);
        const label = document.createElement('div');
        label.className = 'half-suit-label';
        label.textContent = hsInfo ? hsInfo.display : hsName;
        groupDiv.appendChild(label);
        
        const cardsRow = document.createElement('div');
        cardsRow.className = 'cards-row';
        
        cards.forEach(card => {
            const cardEl = document.createElement('div');
            cardEl.className = `card ${card.suit}`;
            cardEl.innerHTML = `
                <span class="rank">${card.rank}</span>
                <span class="suit">${SUIT_SYMBOLS[card.suit]}</span>
            `;
            cardEl.onclick = () => selectCardToAsk(card);
            cardsRow.appendChild(cardEl);
        });
        
        groupDiv.appendChild(cardsRow);
        handDisplayEl.appendChild(groupDiv);
    });
}

function selectCardToAsk(card) {
    // Find cards in same half-suit that we can ask for
    const hs = getHalfSuit(card);
    const validCards = gameState.validAsks.filter(c => getHalfSuit(c) === hs);
    
    if (validCards.length > 0) {
        // Find this half-suit's cards in dropdown
        for (let i = 0; i < cardToAskEl.options.length; i++) {
            if (cardToAskEl.options[i].value.endsWith(`_${card.suit}`) && 
                getHalfSuit({ rank: cardToAskEl.options[i].value.split('_')[0], suit: card.suit }) === hs) {
                cardToAskEl.selectedIndex = i;
                break;
            }
        }
    }
}

function renderActionPanels() {
    const isMyTurn = gameState.currentTurn === gameState.myIndex;
    const hasCards = gameState.hand.length > 0;
    const myTeam = gameState.myTeam;
    const currentTurnTeam = gameState.players[gameState.currentTurn].team;
    const canClaim = myTeam === currentTurnTeam;
    
    // Ask panel
    if (hasCards && isMyTurn) {
        askPanelEl.classList.remove('disabled', 'hidden');
        passPanelEl.classList.add('hidden');
        
        // Populate opponents
        targetPlayerEl.innerHTML = '';
        gameState.opponents.forEach(opp => {
            const opt = document.createElement('option');
            opt.value = opp.id;
            opt.textContent = `${opp.name} (${opp.cardCount} cards)`;
            targetPlayerEl.appendChild(opt);
        });
        
        // Populate valid cards
        cardToAskEl.innerHTML = '';
        gameState.validAsks.forEach(card => {
            const opt = document.createElement('option');
            opt.value = card.id;
            opt.textContent = `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
            cardToAskEl.appendChild(opt);
        });
        
        askBtnEl.disabled = gameState.opponents.length === 0 || gameState.validAsks.length === 0;
    } else if (!hasCards && isMyTurn) {
        askPanelEl.classList.add('hidden');
        passPanelEl.classList.remove('hidden');
        
        // Populate teammates
        passTargetEl.innerHTML = '';
        gameState.players.forEach((p, idx) => {
            if (p.team === myTeam && p.id !== myId && p.cardCount > 0) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                passTargetEl.appendChild(opt);
            }
        });
        
        passBtnEl.disabled = passTargetEl.options.length === 0;
    } else {
        askPanelEl.classList.add('disabled');
        passPanelEl.classList.add('hidden');
    }
    
    // Claim panel
    if (canClaim) {
        claimPanelEl.classList.remove('disabled');
        
        // Populate claimable half-suits (ones I have cards in, not yet claimed)
        claimHalfSuitEl.innerHTML = '';
        const myHalfSuits = new Set(gameState.hand.map(c => getHalfSuit(c)));
        
        gameState.halfSuits.forEach(hs => {
            if (!gameState.claimedSuits.includes(hs.name) && !gameState.middleSuits.includes(hs.name)) {
                const opt = document.createElement('option');
                opt.value = hs.name;
                opt.textContent = hs.display;
                claimHalfSuitEl.appendChild(opt);
            }
        });
        
        showClaimBtnEl.disabled = claimHalfSuitEl.options.length === 0;
    } else {
        claimPanelEl.classList.add('disabled');
    }
    
    // Reset claim assignments when not visible
    if (!canClaim) {
        claimAssignmentsEl.classList.add('hidden');
    }
}

function renderLog() {
    gameLogEl.innerHTML = '';
    
    // Show most recent first (reversed)
    [...gameState.log].reverse().forEach(entry => {
        const div = document.createElement('div');
        div.className = `log-entry ${entry.type}`;
        div.textContent = entry.message;
        gameLogEl.appendChild(div);
    });
}

function getHalfSuit(card) {
    const lowRanks = ['2', '3', '4', '5', '6', '7'];
    const isLow = lowRanks.includes(card.rank);
    return `${isLow ? 'low' : 'high'}_${card.suit}`;
}

function showNotification(message, type = 'info') {
    notificationEl.textContent = message;
    notificationEl.className = `notification ${type}`;
    notificationEl.classList.remove('hidden');
    
    setTimeout(() => {
        notificationEl.classList.add('hidden');
    }, 3000);
}

// Event handlers
askBtnEl.addEventListener('click', () => {
    const targetId = targetPlayerEl.value;
    const cardId = cardToAskEl.value;
    
    if (!targetId || !cardId) {
        showNotification('Select a player and card', 'error');
        return;
    }
    
    socket.emit('askCard', { targetPlayerId: targetId, cardId }, (response) => {
        if (!response.success) {
            showNotification(response.error, 'error');
        } else if (response.got) {
            showNotification('Got the card! Go again!', 'success');
        }
    });
});

passBtnEl.addEventListener('click', () => {
    const targetId = passTargetEl.value;
    
    if (!targetId) {
        showNotification('Select a teammate', 'error');
        return;
    }
    
    socket.emit('passTurn', { targetPlayerId: targetId }, (response) => {
        if (!response.success) {
            showNotification(response.error, 'error');
        }
    });
});

showClaimBtnEl.addEventListener('click', () => {
    const hsName = claimHalfSuitEl.value;
    if (!hsName) return;
    
    const hsInfo = gameState.halfSuits.find(h => h.name === hsName);
    if (!hsInfo) return;
    
    // Show assignment UI
    claimAssignmentsEl.innerHTML = '';
    claimAssignmentsEl.classList.remove('hidden');
    
    const ranks = hsInfo.ranks;
    const suit = hsInfo.suit;
    
    ranks.forEach(rank => {
        const row = document.createElement('div');
        row.className = 'claim-row';
        
        const label = document.createElement('span');
        label.className = `claim-card-label ${suit}`;
        label.textContent = `${rank}${SUIT_SYMBOLS[suit]}`;
        
        const select = document.createElement('select');
        select.className = 'claim-player-select';
        select.dataset.cardId = `${rank}_${suit}`;
        
        gameState.players.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        });
        
        row.appendChild(label);
        row.appendChild(select);
        claimAssignmentsEl.appendChild(row);
    });
    
    // Add submit button
    const submitBtn = document.createElement('button');
    submitBtn.id = 'submitClaimBtn';
    submitBtn.className = 'btn btn-warning';
    submitBtn.textContent = 'Submit Claim';
    submitBtn.onclick = submitClaim;
    claimAssignmentsEl.appendChild(submitBtn);
});

function submitClaim() {
    const hsName = claimHalfSuitEl.value;
    const selects = claimAssignmentsEl.querySelectorAll('.claim-player-select');
    
    const assignments = {};
    selects.forEach(sel => {
        assignments[sel.dataset.cardId] = sel.value;
    });
    
    socket.emit('makeClaim', { halfSuit: hsName, assignments }, (response) => {
        if (!response.success) {
            showNotification(response.error, 'error');
        } else {
            claimAssignmentsEl.classList.add('hidden');
            showNotification(response.result, response.result.includes('correctly') ? 'success' : 'error');
        }
    });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.target.matches('select')) {
        if (!askPanelEl.classList.contains('disabled') && !askPanelEl.classList.contains('hidden')) {
            askBtnEl.click();
        }
    }
});
