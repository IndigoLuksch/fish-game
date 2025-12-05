const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game state storage
const rooms = new Map();

// Card definitions - no 8s or Jokers
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const LOW_RANKS = ['2', '3', '4', '5', '6', '7'];
const HIGH_RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];

const HALF_SUITS = [];
SUITS.forEach(suit => {
    HALF_SUITS.push({ name: `low_${suit}`, suit, ranks: LOW_RANKS, display: `Low ${capitalize(suit)}` });
    HALF_SUITS.push({ name: `high_${suit}`, suit, ranks: HIGH_RANKS, display: `High ${capitalize(suit)}` });
});

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Generate 4-char room code
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Create and shuffle deck (48 cards)
function createDeck() {
    const deck = [];
    SUITS.forEach(suit => {
        [...LOW_RANKS, ...HIGH_RANKS].forEach(rank => {
            deck.push({ suit, rank, id: `${rank}_${suit}` });
        });
    });
    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Get half-suit for a card
function getHalfSuit(card) {
    const isLow = LOW_RANKS.includes(card.rank);
    return `${isLow ? 'low' : 'high'}_${card.suit}`;
}

// Get all cards in a half-suit
function getHalfSuitCards(halfSuitName) {
    const [level, suit] = halfSuitName.split('_');
    const ranks = level === 'low' ? LOW_RANKS : HIGH_RANKS;
    return ranks.map(rank => ({ suit, rank, id: `${rank}_${suit}` }));
}

// Get player's team (0 or 1)
function getTeam(playerIndex) {
    return playerIndex % 2;
}

// Create new room
function createRoom(code) {
    return {
        code,
        players: [],
        gameStarted: false,
        currentTurn: 0,
        scores: [0, 0],
        claimedSuits: [],
        middleSuits: [],
        log: []
    };
}

// Deal cards to players
function dealCards(room) {
    const deck = createDeck();
    const numPlayers = room.players.length;
    const cardsPerPlayer = Math.floor(48 / numPlayers);
    const extraCards = 48 % numPlayers;
    
    let cardIndex = 0;
    room.players.forEach((player, idx) => {
        player.hand = [];
        const numCards = cardsPerPlayer + (idx < extraCards ? 1 : 0);
        for (let i = 0; i < numCards; i++) {
            player.hand.push(deck[cardIndex++]);
        }
        // Sort hand by half-suit
        player.hand.sort((a, b) => {
            const hsA = getHalfSuit(a);
            const hsB = getHalfSuit(b);
            if (hsA !== hsB) return hsA.localeCompare(hsB);
            const ranksOrder = [...LOW_RANKS, ...HIGH_RANKS];
            return ranksOrder.indexOf(a.rank) - ranksOrder.indexOf(b.rank);
        });
    });
}

// Get valid cards a player can ask for
function getValidAsks(player, room) {
    const validCards = [];
    const myHalfSuits = new Set(player.hand.map(card => getHalfSuit(card)));
    
    myHalfSuits.forEach(hs => {
        const hsCards = getHalfSuitCards(hs);
        hsCards.forEach(card => {
            // Can't ask for cards you have
            if (!player.hand.some(c => c.id === card.id)) {
                // Can't ask for cards already claimed
                if (!room.claimedSuits.includes(hs) && !room.middleSuits.includes(hs)) {
                    validCards.push(card);
                }
            }
        });
    });
    return validCards;
}

// Get opponents for a player
function getOpponents(playerIndex, room) {
    const myTeam = getTeam(playerIndex);
    return room.players
        .map((p, idx) => ({ ...p, index: idx }))
        .filter((p, idx) => getTeam(idx) !== myTeam && p.hand.length > 0);
}

// Add log entry
function addLog(room, message, type = 'info') {
    room.log.push({ message, type, timestamp: Date.now() });
}

// Get game state for a specific player
function getGameState(room, playerId) {
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    const player = room.players[playerIndex];
    
    return {
        roomCode: room.code,
        players: room.players.map((p, idx) => ({
            id: p.id,
            name: p.name,
            team: getTeam(idx),
            cardCount: p.hand.length,
            index: idx
        })),
        myIndex: playerIndex,
        myTeam: getTeam(playerIndex),
        hand: player ? player.hand : [],
        currentTurn: room.currentTurn,
        scores: room.scores,
        claimedSuits: room.claimedSuits,
        middleSuits: room.middleSuits,
        log: room.log,
        gameStarted: room.gameStarted,
        validAsks: player && room.gameStarted ? getValidAsks(player, room) : [],
        opponents: player && room.gameStarted ? getOpponents(playerIndex, room) : [],
        halfSuits: HALF_SUITS
    };
}

// Emit updated state to all players in room
function broadcastGameState(room) {
    room.players.forEach(player => {
        const socket = io.sockets.sockets.get(player.socketId);
        if (socket) {
            socket.emit('gameState', getGameState(room, player.id));
        }
    });
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Create room
    socket.on('createRoom', (playerName, callback) => {
        let code;
        do {
            code = generateRoomCode();
        } while (rooms.has(code));
        
        const room = createRoom(code);
        const player = {
            id: socket.id,
            socketId: socket.id,
            name: playerName,
            hand: []
        };
        room.players.push(player);
        rooms.set(code, room);
        
        socket.join(code);
        socket.roomCode = code;
        socket.playerId = socket.id;
        
        callback({ success: true, roomCode: code });
        broadcastGameState(room);
    });
    
    // Join room
    socket.on('joinRoom', (data, callback) => {
        const { roomCode, playerName } = data;
        const room = rooms.get(roomCode.toUpperCase());
        
        if (!room) {
            callback({ success: false, error: 'Room not found' });
            return;
        }
        if (room.gameStarted) {
            callback({ success: false, error: 'Game already in progress' });
            return;
        }
        if (room.players.length >= 8) {
            callback({ success: false, error: 'Room is full' });
            return;
        }
        
        const player = {
            id: socket.id,
            socketId: socket.id,
            name: playerName,
            hand: []
        };
        room.players.push(player);
        
        socket.join(roomCode.toUpperCase());
        socket.roomCode = roomCode.toUpperCase();
        socket.playerId = socket.id;
        
        callback({ success: true, roomCode: roomCode.toUpperCase() });
        broadcastGameState(room);
    });
    
    // Start game
    socket.on('startGame', (callback) => {
        const room = rooms.get(socket.roomCode);
        if (!room) {
            callback({ success: false, error: 'Room not found' });
            return;
        }
        if (room.players.length < 4) {
            callback({ success: false, error: 'Need at least 4 players' });
            return;
        }
        if (room.gameStarted) {
            callback({ success: false, error: 'Game already started' });
            return;
        }
        
        room.gameStarted = true;
        room.currentTurn = 0;
        dealCards(room);
        addLog(room, 'Game started!', 'system');
        addLog(room, `${room.players[0].name}'s turn`, 'turn');
        
        callback({ success: true });
        broadcastGameState(room);
    });
    
    // Ask for a card
    socket.on('askCard', (data, callback) => {
        const { targetPlayerId, cardId } = data;
        const room = rooms.get(socket.roomCode);
        
        if (!room || !room.gameStarted) {
            callback({ success: false, error: 'Game not in progress' });
            return;
        }
        
        const askerIndex = room.players.findIndex(p => p.id === socket.playerId);
        const targetIndex = room.players.findIndex(p => p.id === targetPlayerId);
        const asker = room.players[askerIndex];
        const target = room.players[targetIndex];
        
        // Validate turn
        if (room.currentTurn !== askerIndex) {
            callback({ success: false, error: 'Not your turn' });
            return;
        }
        
        // Validate asker has cards
        if (asker.hand.length === 0) {
            callback({ success: false, error: 'You have no cards' });
            return;
        }
        
        // Validate target is on opposite team
        if (getTeam(askerIndex) === getTeam(targetIndex)) {
            callback({ success: false, error: 'Can only ask opponents' });
            return;
        }
        
        // Validate target has cards
        if (target.hand.length === 0) {
            callback({ success: false, error: 'Target has no cards' });
            return;
        }
        
        // Parse card
        const [rank, suit] = cardId.split('_');
        const card = { rank, suit, id: cardId };
        const halfSuit = getHalfSuit(card);
        
        // Validate asker has a card in this half-suit
        const hasHalfSuit = asker.hand.some(c => getHalfSuit(c) === halfSuit);
        if (!hasHalfSuit) {
            callback({ success: false, error: 'You don\'t have any cards in this half-suit' });
            return;
        }
        
        // Validate asker doesn't already have this card
        if (asker.hand.some(c => c.id === cardId)) {
            callback({ success: false, error: 'You already have this card' });
            return;
        }
        
        // Check if target has the card
        const targetCardIndex = target.hand.findIndex(c => c.id === cardId);
        const cardDisplay = `${rank}${getSuitSymbol(suit)}`;
        
        if (targetCardIndex !== -1) {
            // Target has the card - transfer it
            const [transferredCard] = target.hand.splice(targetCardIndex, 1);
            asker.hand.push(transferredCard);
            // Sort hand
            asker.hand.sort((a, b) => {
                const hsA = getHalfSuit(a);
                const hsB = getHalfSuit(b);
                if (hsA !== hsB) return hsA.localeCompare(hsB);
                const ranksOrder = [...LOW_RANKS, ...HIGH_RANKS];
                return ranksOrder.indexOf(a.rank) - ranksOrder.indexOf(b.rank);
            });
            
            addLog(room, `${asker.name} asked ${target.name} for ${cardDisplay} ✓ Got it!`, 'success');
            // Asker goes again (turn stays the same)
            callback({ success: true, got: true });
        } else {
            // Target doesn't have the card - turn passes to target
            addLog(room, `${asker.name} asked ${target.name} for ${cardDisplay} ✗ Don't have it`, 'fail');
            room.currentTurn = targetIndex;
            addLog(room, `${target.name}'s turn`, 'turn');
            callback({ success: true, got: false });
        }
        
        broadcastGameState(room);
    });
    
    // Make a claim
    socket.on('makeClaim', (data, callback) => {
        const { halfSuit, assignments } = data;
        // assignments: { cardId: playerId, ... }
        
        const room = rooms.get(socket.roomCode);
        if (!room || !room.gameStarted) {
            callback({ success: false, error: 'Game not in progress' });
            return;
        }
        
        const claimerIndex = room.players.findIndex(p => p.id === socket.playerId);
        const claimer = room.players[claimerIndex];
        const claimerTeam = getTeam(claimerIndex);
        const currentTurnTeam = getTeam(room.currentTurn);
        
        // Validate it's claimer's team's turn
        if (claimerTeam !== currentTurnTeam) {
            callback({ success: false, error: 'Can only claim on your team\'s turn' });
            return;
        }
        
        // Validate half-suit not already claimed
        if (room.claimedSuits.includes(halfSuit) || room.middleSuits.includes(halfSuit)) {
            callback({ success: false, error: 'Half-suit already claimed' });
            return;
        }
        
        // Get all cards in the half-suit
        const hsCards = getHalfSuitCards(halfSuit);
        const hsInfo = HALF_SUITS.find(hs => hs.name === halfSuit);
        
        // Validate all 6 cards are assigned
        if (Object.keys(assignments).length !== 6) {
            callback({ success: false, error: 'Must assign all 6 cards' });
            return;
        }
        
        // Check the claim
        let allCorrectTeam = true;
        let allCorrectPlayer = true;
        const actualLocations = {};
        
        hsCards.forEach(card => {
            // Find who actually has this card
            for (const player of room.players) {
                if (player.hand.some(c => c.id === card.id)) {
                    actualLocations[card.id] = player.id;
                    break;
                }
            }
        });
        
        // Determine which team was claimed to have the cards
        const claimedPlayers = new Set(Object.values(assignments));
        const claimedTeams = new Set();
        claimedPlayers.forEach(playerId => {
            const idx = room.players.findIndex(p => p.id === playerId);
            if (idx !== -1) claimedTeams.add(getTeam(idx));
        });
        
        // Check if all cards are on one team
        const actualTeams = new Set();
        Object.values(actualLocations).forEach(playerId => {
            const idx = room.players.findIndex(p => p.id === playerId);
            if (idx !== -1) actualTeams.add(getTeam(idx));
        });
        
        // Check each assignment
        for (const cardId of Object.keys(assignments)) {
            const claimedPlayerId = assignments[cardId];
            const actualPlayerId = actualLocations[cardId];
            
            if (!actualPlayerId) {
                // Card not found (shouldn't happen)
                allCorrectTeam = false;
                allCorrectPlayer = false;
                break;
            }
            
            const claimedPlayerIdx = room.players.findIndex(p => p.id === claimedPlayerId);
            const actualPlayerIdx = room.players.findIndex(p => p.id === actualPlayerId);
            
            if (getTeam(claimedPlayerIdx) !== getTeam(actualPlayerIdx)) {
                allCorrectTeam = false;
                allCorrectPlayer = false;
            } else if (claimedPlayerId !== actualPlayerId) {
                allCorrectPlayer = false;
            }
        }
        
        // Remove cards from all hands
        room.players.forEach(player => {
            player.hand = player.hand.filter(c => getHalfSuit(c) !== halfSuit);
        });
        
        // Determine result
        let resultMessage;
        if (allCorrectTeam && allCorrectPlayer) {
            // Perfect claim
            room.scores[claimerTeam]++;
            room.claimedSuits.push(halfSuit);
            resultMessage = `${claimer.name} correctly claimed ${hsInfo.display}! Team ${claimerTeam + 1} +1 point`;
            addLog(room, resultMessage, 'claim-success');
        } else if (allCorrectTeam) {
            // Right team, wrong players
            room.middleSuits.push(halfSuit);
            resultMessage = `${claimer.name} claimed ${hsInfo.display} - correct team but wrong player assignments. Suit goes to middle.`;
            addLog(room, resultMessage, 'claim-partial');
        } else {
            // Wrong team - opponents get it
            const opponentTeam = 1 - claimerTeam;
            room.scores[opponentTeam]++;
            room.claimedSuits.push(halfSuit);
            resultMessage = `${claimer.name} incorrectly claimed ${hsInfo.display}! Opponent had cards. Team ${opponentTeam + 1} +1 point`;
            addLog(room, resultMessage, 'claim-fail');
        }
        
        // Check for game over
        const totalClaimed = room.claimedSuits.length + room.middleSuits.length;
        if (totalClaimed === 8) {
            const winner = room.scores[0] > room.scores[1] ? 'Team 1' : 
                          room.scores[1] > room.scores[0] ? 'Team 2' : 'Tie';
            addLog(room, `Game Over! ${winner} wins! Final score: ${room.scores[0]} - ${room.scores[1]}`, 'system');
        } else {
            // Find next player with cards for their turn
            advanceTurnIfNeeded(room);
        }
        
        callback({ success: true, result: resultMessage });
        broadcastGameState(room);
    });
    
    // Pass turn (when player has no cards)
    socket.on('passTurn', (data, callback) => {
        const { targetPlayerId } = data;
        const room = rooms.get(socket.roomCode);
        
        if (!room || !room.gameStarted) {
            callback({ success: false, error: 'Game not in progress' });
            return;
        }
        
        const passerIndex = room.players.findIndex(p => p.id === socket.playerId);
        const targetIndex = room.players.findIndex(p => p.id === targetPlayerId);
        const passer = room.players[passerIndex];
        const target = room.players[targetIndex];
        
        if (room.currentTurn !== passerIndex) {
            callback({ success: false, error: 'Not your turn' });
            return;
        }
        
        if (passer.hand.length > 0) {
            callback({ success: false, error: 'You still have cards' });
            return;
        }
        
        if (getTeam(passerIndex) !== getTeam(targetIndex)) {
            callback({ success: false, error: 'Can only pass to teammate' });
            return;
        }
        
        if (target.hand.length === 0) {
            callback({ success: false, error: 'Teammate has no cards either' });
            return;
        }
        
        room.currentTurn = targetIndex;
        addLog(room, `${passer.name} passed turn to ${target.name}`, 'turn');
        
        callback({ success: true });
        broadcastGameState(room);
    });
    
    // Disconnect handling
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const room = rooms.get(socket.roomCode);
        if (room) {
            const playerIndex = room.players.findIndex(p => p.id === socket.playerId);
            if (playerIndex !== -1) {
                const player = room.players[playerIndex];
                addLog(room, `${player.name} disconnected`, 'system');
                
                if (!room.gameStarted) {
                    // Remove from lobby
                    room.players.splice(playerIndex, 1);
                    if (room.players.length === 0) {
                        rooms.delete(socket.roomCode);
                    }
                } else {
                    // Mark as disconnected but keep in game
                    player.disconnected = true;
                    // If it was their turn, advance
                    if (room.currentTurn === playerIndex) {
                        advanceTurnIfNeeded(room);
                    }
                }
                broadcastGameState(room);
            }
        }
    });
});

// Advance turn to next player with cards
function advanceTurnIfNeeded(room) {
    const startTurn = room.currentTurn;
    let attempts = 0;
    
    while (attempts < room.players.length) {
        const currentPlayer = room.players[room.currentTurn];
        if (currentPlayer.hand.length > 0 && !currentPlayer.disconnected) {
            if (room.currentTurn !== startTurn) {
                addLog(room, `${currentPlayer.name}'s turn`, 'turn');
            }
            return;
        }
        room.currentTurn = (room.currentTurn + 1) % room.players.length;
        attempts++;
    }
    
    // No one has cards - game should be over
    addLog(room, 'No players have cards remaining', 'system');
}

function getSuitSymbol(suit) {
    const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    return symbols[suit] || suit;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Fish game server running on port ${PORT}`);
});
