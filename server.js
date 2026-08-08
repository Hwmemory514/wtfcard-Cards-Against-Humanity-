const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { blackCards, whiteCards } = require('./game-data');

const MAX_PLAYERS = 10;
const DISCONNECT_GRACE_MS = 30_000;
const REVEAL_MS = 10_000;

function shuffle(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function cleanRoomId(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
}

function validNickname(value) {
  const nick = String(value || '').trim();
  return /^[\p{L}\p{N}]{1,12}$/u.test(nick) ? nick : null;
}

function randomRoomId(rooms) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function createGameServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 100_000
  });
  const rooms = new Map();

  app.disable('x-powered-by');
  app.get('/health', (_request, response) => response.json({ ok: true, rooms: rooms.size }));
  app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd')));
  app.use(express.static(path.join(__dirname, 'public')));

  function newRoom(id) {
    return {
      id,
      players: new Map(),
      hostPlayerId: null,
      judgePlayerId: null,
      announcement: '',
      round: null,
      whiteDeck: shuffle(whiteCards),
      usedBlackCards: new Set(),
      revealTimer: null
    };
  }

  function getSocketPlayer(socket) {
    const room = rooms.get(socket.data.roomId);
    const player = room?.players.get(socket.data.playerId);
    return room && player ? { room, player } : null;
  }

  function connectedPlayers(room) {
    return [...room.players.values()].filter(player => player.connected);
  }

  function emitNotice(room, text, kind = 'info') {
    io.to(room.id).emit('notice', { text, kind });
  }

  function publicRound(room, player) {
    const round = room.round;
    if (!round) return null;

    const submittedIds = new Set(round.answers.keys());
    const answerList = round.answerOrder.map(playerId => {
      const answer = round.answers.get(playerId);
      const answerPlayer = room.players.get(playerId);
      return answer && answerPlayer ? { playerId, nick: answerPlayer.nick, text: answer } : null;
    }).filter(Boolean);
    const winner = round.winnerPlayerId ? room.players.get(round.winnerPlayerId) : null;

    return {
      id: round.id,
      phase: round.phase,
      question: round.question,
      submittedCount: round.answers.size,
      expectedCount: round.participantIds.length - 1,
      submittedBySelf: submittedIds.has(player.id),
      answers: round.phase === 'answering' ? [] : answerList,
      hand: round.phase === 'answering' && !submittedIds.has(player.id)
        ? (round.hands.get(player.id) || [])
        : [],
      hasFreeCard: round.phase === 'answering'
        && round.freeCardPlayerIds.has(player.id)
        && !submittedIds.has(player.id),
      winner: winner ? {
        playerId: winner.id,
        nick: winner.nick,
        text: round.answers.get(winner.id),
        filledText: round.question.replace(/_+/, round.answers.get(winner.id)),
        revealEndsAt: round.revealEndsAt
      } : null
    };
  }

  function stateFor(room, player) {
    const roundParticipants = new Set(room.round?.participantIds || []);
    return {
      roomId: room.id,
      selfPlayerId: player.id,
      hostPlayerId: room.hostPlayerId,
      judgePlayerId: room.judgePlayerId,
      announcement: room.announcement,
      players: [...room.players.values()].map(item => ({
        id: item.id,
        nick: item.nick,
        score: item.score,
        connected: item.connected,
        waitingForNextRound: Boolean(room.round && !roundParticipants.has(item.id))
      })),
      round: publicRound(room, player),
      canStart: !room.round
        && player.id === room.judgePlayerId
        && connectedPlayers(room).length >= 2
    };
  }

  function broadcastState(room) {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;
      io.to(player.socketId).emit('state', stateFor(room, player));
    }
  }

  function nextConnectedPlayerId(room, currentPlayerId) {
    const players = [...room.players.values()];
    if (!players.length) return null;
    const foundIndex = players.findIndex(player => player.id === currentPlayerId);
    const currentIndex = foundIndex === -1 ? -1 : foundIndex;
    for (let offset = 1; offset <= players.length; offset += 1) {
      const candidate = players[(currentIndex + offset) % players.length];
      if (candidate.connected) return candidate.id;
    }
    return null;
  }

  function clearRevealTimer(room) {
    if (room.revealTimer) clearTimeout(room.revealTimer);
    room.revealTimer = null;
  }

  function drawWhiteCards(room, count) {
    if (room.whiteDeck.length < count) room.whiteDeck = shuffle(whiteCards);
    return room.whiteDeck.splice(0, count);
  }

  function drawBlackCard(room) {
    if (room.usedBlackCards.size >= Math.ceil(blackCards.length * 0.7)) {
      room.usedBlackCards.clear();
    }
    const available = blackCards.map((_, index) => index)
      .filter(index => !room.usedBlackCards.has(index));
    const index = available[crypto.randomInt(available.length)];
    room.usedBlackCards.add(index);
    return blackCards[index];
  }

  function startRound(room) {
    const participants = connectedPlayers(room);
    if (room.round || participants.length < 2) return false;
    if (!participants.some(player => player.id === room.judgePlayerId)) {
      room.judgePlayerId = participants[0].id;
    }

    const hands = new Map();
    const freeCardPlayerIds = new Set();
    for (const player of participants) {
      if (player.id === room.judgePlayerId) continue;
      const cards = drawWhiteCards(room, 5).map((text, index) => ({
        id: `${player.id}:${Date.now()}:${index}:${crypto.randomBytes(3).toString('hex')}`,
        text
      }));
      hands.set(player.id, cards);
      if (crypto.randomInt(100) < 5) freeCardPlayerIds.add(player.id);
    }

    room.round = {
      id: crypto.randomUUID(),
      phase: 'answering',
      question: drawBlackCard(room),
      judgePlayerId: room.judgePlayerId,
      participantIds: participants.map(player => player.id),
      hands,
      freeCardPlayerIds,
      answers: new Map(),
      answerOrder: [],
      winnerPlayerId: null,
      revealEndsAt: null
    };
    broadcastState(room);
    return true;
  }

  function finishAnsweringIfReady(room) {
    const round = room.round;
    if (!round || round.phase !== 'answering') return;
    const expectedIds = round.participantIds.filter(id => id !== round.judgePlayerId);
    if (!expectedIds.every(id => round.answers.has(id))) return;
    round.phase = 'judging';
    round.answerOrder = shuffle(expectedIds);
    broadcastState(room);
  }

  function finishReveal(room) {
    if (!room.round || room.round.phase !== 'reveal') return;
    const previousJudge = room.judgePlayerId;
    room.round = null;
    room.judgePlayerId = nextConnectedPlayerId(room, previousJudge);
    clearRevealTimer(room);
    if (connectedPlayers(room).length >= 2 && room.judgePlayerId) startRound(room);
    else broadcastState(room);
  }

  function removePlayer(room, playerId, reason = '离开了房间') {
    const player = room.players.get(playerId);
    if (!player) return;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    const wasHost = room.hostPlayerId === playerId;
    const wasJudge = room.judgePlayerId === playerId;

    room.players.delete(playerId);
    if (!room.players.size) {
      clearRevealTimer(room);
      rooms.delete(room.id);
      return;
    }

    if (room.round?.participantIds.includes(playerId)) {
      room.round.participantIds = room.round.participantIds.filter(id => id !== playerId);
      room.round.hands.delete(playerId);
      room.round.freeCardPlayerIds.delete(playerId);
      room.round.answers.delete(playerId);
      room.round.answerOrder = room.round.answerOrder.filter(id => id !== playerId);
      if (wasJudge) {
        clearRevealTimer(room);
        room.round = null;
      }
    }

    if (wasHost) {
      room.hostPlayerId = connectedPlayers(room)[0]?.id || [...room.players.keys()][0];
    }
    if (wasJudge) {
      room.judgePlayerId = nextConnectedPlayerId(room, playerId)
        || connectedPlayers(room)[0]?.id
        || [...room.players.keys()][0];
    }
    emitNotice(room, `${player.nick}${reason}`);
    finishAnsweringIfReady(room);
    broadcastState(room);
  }

  function attachPlayerSocket(socket, room, player) {
    const previousSocket = player.socketId && io.sockets.sockets.get(player.socketId);
    if (previousSocket && previousSocket.id !== socket.id) {
      previousSocket.data.suppressDisconnect = true;
      previousSocket.disconnect(true);
    }
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.socketId = socket.id;
    player.connected = true;
    socket.data.roomId = room.id;
    socket.data.playerId = player.id;
    socket.join(room.id);
  }

  function actionResult(callback, ok, message, extra = {}) {
    if (typeof callback === 'function') callback({ ok, message, ...extra });
  }

  io.on('connection', socket => {
    socket.on('create-room', (payload = {}, callback) => {
      if (getSocketPlayer(socket)) return actionResult(callback, false, '你已经在房间中');
      const nick = validNickname(payload.nick);
      if (!nick) return actionResult(callback, false, '昵称只能包含 1-12 个中英文或数字');
      const requestedId = cleanRoomId(payload.roomId);
      if (payload.roomId && requestedId.length < 3) {
        return actionResult(callback, false, '自定义房间号至少需要 3 个字符');
      }
      const roomId = requestedId || randomRoomId(rooms);
      if (rooms.has(roomId)) return actionResult(callback, false, '房间号已被使用');

      const room = newRoom(roomId);
      const player = {
        id: crypto.randomUUID(),
        sessionToken: crypto.randomBytes(24).toString('base64url'),
        socketId: socket.id,
        nick,
        score: 0,
        connected: true,
        disconnectTimer: null
      };
      room.players.set(player.id, player);
      room.hostPlayerId = player.id;
      room.judgePlayerId = player.id;
      rooms.set(roomId, room);
      attachPlayerSocket(socket, room, player);
      actionResult(callback, true, '', {
        roomId,
        playerId: player.id,
        sessionToken: player.sessionToken
      });
      broadcastState(room);
    });

    socket.on('join-room', (payload = {}, callback) => {
      if (getSocketPlayer(socket)) return actionResult(callback, false, '你已经在房间中');
      const roomId = cleanRoomId(payload.roomId);
      const room = rooms.get(roomId);
      const nick = validNickname(payload.nick);
      if (!room) return actionResult(callback, false, '房间不存在或已经关闭');
      if (!nick) return actionResult(callback, false, '昵称只能包含 1-12 个中英文或数字');
      if (room.players.size >= MAX_PLAYERS) return actionResult(callback, false, '房间已满');
      if ([...room.players.values()].some(player => player.nick === nick)) {
        return actionResult(callback, false, '房间里已经有同名玩家');
      }

      const player = {
        id: crypto.randomUUID(),
        sessionToken: crypto.randomBytes(24).toString('base64url'),
        socketId: socket.id,
        nick,
        score: 0,
        connected: true,
        disconnectTimer: null
      };
      room.players.set(player.id, player);
      attachPlayerSocket(socket, room, player);
      actionResult(callback, true, '', {
        roomId,
        playerId: player.id,
        sessionToken: player.sessionToken
      });
      emitNotice(room, `${nick} 加入了房间`);
      broadcastState(room);
    });

    socket.on('resume-room', (payload = {}, callback) => {
      const room = rooms.get(cleanRoomId(payload.roomId));
      const player = room && [...room.players.values()]
        .find(item => item.sessionToken === payload.sessionToken);
      if (!room || !player) return actionResult(callback, false, '房间会话已经失效');
      attachPlayerSocket(socket, room, player);
      actionResult(callback, true, '', { roomId: room.id, playerId: player.id });
      emitNotice(room, `${player.nick} 已重新连接`, 'success');
      broadcastState(room);
    });

    socket.on('start-round', (_payload, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const { room, player } = context;
      if (player.id !== room.judgePlayerId) return actionResult(callback, false, '只有本轮裁判可以开始');
      if (!startRound(room)) return actionResult(callback, false, '当前无法开始新一轮');
      actionResult(callback, true, '');
    });

    socket.on('submit-answer', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const { room, player } = context;
      const round = room.round;
      if (!round || round.phase !== 'answering') return actionResult(callback, false, '当前不能提交答案');
      if (!round.participantIds.includes(player.id) || player.id === round.judgePlayerId) {
        return actionResult(callback, false, '你不是本轮答题玩家');
      }
      if (round.answers.has(player.id)) return actionResult(callback, false, '本轮已经提交过答案');

      let answer;
      if (payload.cardId) {
        const card = (round.hands.get(player.id) || []).find(item => item.id === payload.cardId);
        if (!card) return actionResult(callback, false, '这张牌不在你的本轮手牌中');
        answer = card.text;
      } else {
        const freeText = String(payload.freeText || '').trim();
        if (!round.freeCardPlayerIds.has(player.id)) return actionResult(callback, false, '本轮没有自由卡');
        if (!freeText || freeText.length > 80) return actionResult(callback, false, '自由答案需要 1-80 个字符');
        answer = freeText;
        round.freeCardPlayerIds.delete(player.id);
      }
      round.answers.set(player.id, answer);
      actionResult(callback, true, '');
      finishAnsweringIfReady(room);
      broadcastState(room);
    });

    socket.on('select-winner', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const { room, player } = context;
      const round = room.round;
      if (!round || round.phase !== 'judging') return actionResult(callback, false, '当前不是裁决阶段');
      if (player.id !== round.judgePlayerId) return actionResult(callback, false, '只有本轮裁判可以选择赢家');
      if (!round.answers.has(payload.playerId)) return actionResult(callback, false, '答案不存在');

      const winner = room.players.get(payload.playerId);
      if (!winner) return actionResult(callback, false, '玩家已经离开');
      winner.score += 1;
      round.phase = 'reveal';
      round.winnerPlayerId = winner.id;
      round.revealEndsAt = Date.now() + REVEAL_MS;
      actionResult(callback, true, '');
      broadcastState(room);
      room.revealTimer = setTimeout(() => finishReveal(room), REVEAL_MS);
      room.revealTimer.unref?.();
    });

    socket.on('chat-message', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const text = String(payload.text || '').trim();
      if (!text || text.length > 120) return actionResult(callback, false, '消息需要 1-120 个字符');
      io.to(context.room.id).emit('chat-message', {
        sender: context.player.nick,
        text,
        timestamp: Date.now()
      });
      actionResult(callback, true, '');
    });

    socket.on('update-announcement', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      if (context.player.id !== context.room.hostPlayerId) {
        return actionResult(callback, false, '只有房主可以修改公告');
      }
      const text = String(payload.text || '').trim();
      if (text.length > 500) return actionResult(callback, false, '公告最多 500 个字符');
      context.room.announcement = text;
      actionResult(callback, true, '');
      broadcastState(context.room);
    });

    socket.on('restart-game', (_payload, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const { room, player } = context;
      if (player.id !== room.hostPlayerId) return actionResult(callback, false, '只有房主可以重启游戏');
      clearRevealTimer(room);
      room.round = null;
      room.usedBlackCards.clear();
      room.whiteDeck = shuffle(whiteCards);
      for (const item of room.players.values()) item.score = 0;
      room.judgePlayerId = player.id;
      actionResult(callback, true, '');
      emitNotice(room, '游戏已重启，分数已重置');
      broadcastState(room);
    });

    socket.on('leave-room', (_payload, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, true, '');
      socket.data.suppressDisconnect = true;
      socket.leave(context.room.id);
      socket.data.roomId = null;
      socket.data.playerId = null;
      removePlayer(context.room, context.player.id);
      actionResult(callback, true, '');
    });

    socket.on('disconnect', () => {
      if (socket.data.suppressDisconnect) return;
      const context = getSocketPlayer(socket);
      if (!context) return;
      const { room, player } = context;
      if (player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      player.disconnectTimer = setTimeout(() => removePlayer(room, player.id), DISCONNECT_GRACE_MS);
      player.disconnectTimer.unref?.();
      emitNotice(room, `${player.nick} 连接中断，保留席位 30 秒`, 'warning');
      broadcastState(room);
    });
  });

  return { app, server, io, rooms };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createGameServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`WTF Card Online listening on http://localhost:${port}`);
  });
}

module.exports = { createGameServer };
