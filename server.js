const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { blackCards, whiteCards } = require('./game-data');

const MAX_PLAYERS = 10;
const DISCONNECT_GRACE_MS = 30_000;
const ANSWERING_MS = 30_000;
const JUDGING_MS = 25_000;
const REVEAL_MS = 10_000;
const SERVER_STARTED_AT = new Date().toISOString();
const graphemeSegmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const whiteCardCatalog = whiteCards.map((text, index) => ({ id: `white:${index}`, text }));

function graphemeLength(value) {
  let length = 0;
  for (const _segment of graphemeSegmenter.segment(value)) length += 1;
  return length;
}

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
  const answeringMs = Number.isFinite(options.answeringMs) ? Math.max(1, options.answeringMs) : ANSWERING_MS;
  const judgingMs = Number.isFinite(options.judgingMs) ? Math.max(1, options.judgingMs) : JUDGING_MS;
  const revealMs = Number.isFinite(options.revealMs) ? Math.max(1, options.revealMs) : REVEAL_MS;
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 100_000
  });
  const rooms = new Map();

  app.disable('x-powered-by');
  app.get('/health', (_request, response) => response.json({
    ok: true,
    rooms: rooms.size,
    startedAt: SERVER_STARTED_AT
  }));
  app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd')));
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(response, filePath) {
      if (/\.(?:html|css|js)$/i.test(filePath)) {
        response.setHeader('Cache-Control', 'no-store');
      }
    }
  }));

  function newRoom(id) {
    return {
      id,
      players: new Map(),
      hostPlayerId: null,
      judgePlayerId: null,
      announcement: '',
      round: null,
      usedBlackCards: new Set(),
      answeringTimer: null,
      judgingTimer: null,
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
    const answerList = round.answerOptions.map(option => {
      const answer = round.answers.get(option.playerId);
      if (!answer) return null;
      if (round.phase === 'judging') return { id: option.id, text: answer };

      const answerPlayer = room.players.get(option.playerId);
      return answerPlayer ? {
        id: option.id,
        playerId: option.playerId,
        nick: answerPlayer.nick,
        text: answer,
        isWinner: option.playerId === round.winnerPlayerId
      } : null;
    }).filter(Boolean);
    const winner = round.winnerPlayerId ? room.players.get(round.winnerPlayerId) : null;

    return {
      id: round.id,
      phase: round.phase,
      question: round.question,
      answeringEndsAt: round.answeringEndsAt,
      answeringDurationMs: answeringMs,
      judgingEndsAt: round.judgingEndsAt,
      judgingDurationMs: judgingMs,
      submittedCount: round.answers.size,
      expectedCount: round.participantIds.length - 1,
      submittedBySelf: submittedIds.has(player.id),
      answers: round.phase === 'answering' ? [] : answerList,
      hand: round.phase === 'answering'
        ? (round.hands.get(player.id) || [])
          .filter(card => card.id !== round.selectedCardIds.get(player.id))
          .map(card => ({
            ...card,
            locked: round.lockedCardIds.get(player.id)?.has(card.id) || false
          }))
        : [],
      hasFreeCard: round.phase === 'answering'
        && round.freeCardPlayerIds.has(player.id)
        && !submittedIds.has(player.id),
      winner: winner ? {
        answerId: round.answerOptions.find(option => option.playerId === winner.id)?.id,
        playerId: winner.id,
        nick: winner.nick,
        text: round.answers.get(winner.id),
        filledText: round.question.replace(/_+/, round.answers.get(winner.id)),
        revealEndsAt: round.revealEndsAt,
        revealDurationMs: revealMs
      } : null
    };
  }

  function stateFor(room, player) {
    const roundParticipants = new Set(room.round?.participantIds || []);
    return {
      serverNow: Date.now(),
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

  function clearJudgingTimer(room) {
    if (room.judgingTimer) clearTimeout(room.judgingTimer);
    room.judgingTimer = null;
  }

  function clearAnsweringTimer(room) {
    if (room.answeringTimer) clearTimeout(room.answeringTimer);
    room.answeringTimer = null;
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
    const lockedCardIds = new Map();
    const freeCardPlayerIds = new Set();
    for (const player of room.players.values()) {
      player.lockedCards = player.lockedCards.slice(0, 4);
    }
    const reservedCardIds = new Set(
      [...room.players.values()].flatMap(player => player.lockedCards.map(card => card.id))
    );
    const availableCards = shuffle(whiteCardCatalog.filter(card => !reservedCardIds.has(card.id)));
    for (const player of participants) {
      if (player.id === room.judgePlayerId) continue;
      const retainedCards = player.lockedCards.slice(0, 4);
      const cards = [...retainedCards, ...availableCards.splice(0, 5 - retainedCards.length)];
      if (cards.length !== 5) return false;
      hands.set(player.id, cards);
      lockedCardIds.set(player.id, new Set(retainedCards.map(card => card.id)));
      if (crypto.randomInt(100) < 5) freeCardPlayerIds.add(player.id);
    }

    const answeringEndsAt = Date.now() + answeringMs;
    room.round = {
      id: crypto.randomUUID(),
      phase: 'answering',
      question: drawBlackCard(room),
      judgePlayerId: room.judgePlayerId,
      participantIds: participants.map(player => player.id),
      hands,
      lockedCardIds,
      freeCardPlayerIds,
      answers: new Map(),
      selectedCardIds: new Map(),
      answerOptions: [],
      winnerPlayerId: null,
      answeringEndsAt,
      judgingEndsAt: null,
      revealEndsAt: null
    };
    clearAnsweringTimer(room);
    room.answeringTimer = setTimeout(() => submitDefaultAnswers(room), answeringMs);
    room.answeringTimer.unref?.();
    broadcastState(room);
    return true;
  }

  function persistLockedCards(room, round) {
    for (const playerId of round.participantIds) {
      const player = room.players.get(playerId);
      if (!player || playerId === round.judgePlayerId) continue;
      const lockedIds = round.lockedCardIds.get(playerId) || new Set();
      const selectedCardId = round.selectedCardIds.get(playerId);
      player.lockedCards = (round.hands.get(playerId) || [])
        .filter(card => lockedIds.has(card.id) && card.id !== selectedCardId)
        .slice(0, 4);
    }
  }

  function submitDefaultAnswers(room) {
    const round = room.round;
    if (!round || round.phase !== 'answering') return;
    clearAnsweringTimer(room);

    let autoSubmittedCount = 0;
    for (const playerId of round.participantIds) {
      if (playerId === round.judgePlayerId || round.answers.has(playerId)) continue;
      const hand = round.hands.get(playerId) || [];
      const lockedIds = round.lockedCardIds.get(playerId) || new Set();
      let firstUnlockedCard = hand.find(card => !lockedIds.has(card.id));
      if (!firstUnlockedCard && hand.length) {
        firstUnlockedCard = hand[hand.length - 1];
        lockedIds.delete(firstUnlockedCard.id);
      }
      if (!firstUnlockedCard) continue;
      round.answers.set(playerId, firstUnlockedCard.text);
      round.selectedCardIds.set(playerId, firstUnlockedCard.id);
      autoSubmittedCount += 1;
    }

    if (autoSubmittedCount) {
      emitNotice(room, `选牌时间结束，已为 ${autoSubmittedCount} 名未提交玩家自动打出第一张未锁定牌`);
    }
    finishAnsweringIfReady(room);
    if (room.round?.phase === 'answering') broadcastState(room);
  }

  function finishAnsweringIfReady(room) {
    const round = room.round;
    if (!round || round.phase !== 'answering') return;
    const expectedIds = round.participantIds.filter(id => id !== round.judgePlayerId);
    if (!expectedIds.every(id => round.answers.has(id))) return;
    clearAnsweringTimer(room);
    persistLockedCards(room, round);
    round.phase = 'judging';
    round.answeringEndsAt = null;
    round.answerOptions = shuffle(expectedIds).map(playerId => ({
      id: crypto.randomUUID(),
      playerId
    }));
    round.judgingEndsAt = Date.now() + judgingMs;
    clearJudgingTimer(room);
    room.judgingTimer = setTimeout(() => selectRandomWinner(room), judgingMs);
    room.judgingTimer.unref?.();
    broadcastState(room);
  }

  function finishJudging(room, selectedAnswer) {
    const round = room.round;
    if (!round || round.phase !== 'judging') return false;
    if (!selectedAnswer || !round.answers.has(selectedAnswer.playerId)) return false;

    const winner = room.players.get(selectedAnswer.playerId);
    if (!winner) return false;
    clearJudgingTimer(room);
    clearRevealTimer(room);
    winner.score += 1;
    round.phase = 'reveal';
    round.winnerPlayerId = winner.id;
    round.judgingEndsAt = null;
    round.revealEndsAt = Date.now() + revealMs;
    room.revealTimer = setTimeout(() => finishReveal(room), revealMs);
    room.revealTimer.unref?.();
    return true;
  }

  function selectRandomWinner(room) {
    const round = room.round;
    if (!round || round.phase !== 'judging') return;
    const availableAnswers = round.answerOptions.filter(option => (
      round.answers.has(option.playerId) && room.players.has(option.playerId)
    ));
    if (!availableAnswers.length) {
      clearJudgingTimer(room);
      room.round = null;
      broadcastState(room);
      return;
    }

    const selectedAnswer = availableAnswers[crypto.randomInt(availableAnswers.length)];
    if (!finishJudging(room, selectedAnswer)) return;
    emitNotice(room, '裁判选择超时，系统已随机选出本轮赢家');
    broadcastState(room);
  }

  function finishReveal(room) {
    if (!room.round || room.round.phase !== 'reveal') return;
    const previousJudge = room.judgePlayerId;
    room.round = null;
    room.judgePlayerId = nextConnectedPlayerId(room, previousJudge);
    clearAnsweringTimer(room);
    clearJudgingTimer(room);
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
      clearAnsweringTimer(room);
      clearJudgingTimer(room);
      clearRevealTimer(room);
      rooms.delete(room.id);
      return;
    }

    if (room.round?.participantIds.includes(playerId)) {
      room.round.participantIds = room.round.participantIds.filter(id => id !== playerId);
      room.round.hands.delete(playerId);
      room.round.lockedCardIds.delete(playerId);
      room.round.freeCardPlayerIds.delete(playerId);
      room.round.answers.delete(playerId);
      room.round.selectedCardIds.delete(playerId);
      room.round.answerOptions = room.round.answerOptions.filter(option => option.playerId !== playerId);
      if (wasJudge) {
        persistLockedCards(room, room.round);
        clearAnsweringTimer(room);
        clearJudgingTimer(room);
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
    socket.on('sync-time', (_payload, callback) => {
      if (typeof callback === 'function') callback({ serverNow: Date.now() });
    });

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
        lockedCards: [],
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
        lockedCards: [],
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

    socket.on('set-card-lock', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const { room, player } = context;
      const round = room.round;
      if (!round || round.phase !== 'answering') return actionResult(callback, false, '当前不能锁定手牌');
      if (!round.participantIds.includes(player.id) || player.id === round.judgePlayerId) {
        return actionResult(callback, false, '你不是本轮答题玩家');
      }
      if (round.selectedCardIds.get(player.id) === payload.cardId) {
        return actionResult(callback, false, '已经打出的牌不能锁定');
      }
      const card = (round.hands.get(player.id) || []).find(item => item.id === payload.cardId);
      if (!card) return actionResult(callback, false, '这张牌不在你的本轮手牌中');

      const lockedIds = round.lockedCardIds.get(player.id) || new Set();
      if (payload.locked === true) {
        if (!lockedIds.has(card.id) && lockedIds.size >= 4) {
          return actionResult(callback, false, '每名玩家最多保留 4 张牌');
        }
        lockedIds.add(card.id);
      } else {
        lockedIds.delete(card.id);
      }
      round.lockedCardIds.set(player.id, lockedIds);
      actionResult(callback, true, '', { locked: lockedIds.has(card.id) });
      broadcastState(room);
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
        round.selectedCardIds.set(player.id, card.id);
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
      const selectedAnswer = round.answerOptions.find(option => option.id === payload.answerId);
      if (!selectedAnswer || !round.answers.has(selectedAnswer.playerId)) {
        return actionResult(callback, false, '答案不存在');
      }

      if (!finishJudging(room, selectedAnswer)) {
        return actionResult(callback, false, '玩家已经离开');
      }
      actionResult(callback, true, '');
      broadcastState(room);
    });

    socket.on('chat-message', (payload = {}, callback) => {
      const context = getSocketPlayer(socket);
      if (!context) return actionResult(callback, false, '尚未加入房间');
      const text = String(payload.text || '').trim();
      if (!text || graphemeLength(text) > 120) return actionResult(callback, false, '消息需要 1-120 个字符');
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
      clearAnsweringTimer(room);
      clearJudgingTimer(room);
      clearRevealTimer(room);
      room.round = null;
      room.usedBlackCards.clear();
      for (const item of room.players.values()) {
        item.score = 0;
        item.lockedCards = [];
      }
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
