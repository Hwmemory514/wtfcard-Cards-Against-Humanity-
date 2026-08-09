const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createGameServer } = require('../server');

let gameServer;
let baseUrl;
const clients = [];

function trackedClient(url = baseUrl) {
  const socket = createClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  const tracked = { socket, state: null, waiters: [] };
  socket.on('state', state => {
    tracked.state = state;
    tracked.waiters = tracked.waiters.filter(waiter => {
      if (!waiter.predicate(state)) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(state);
      return false;
    });
  });
  clients.push(tracked);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(tracked));
    socket.once('connect_error', reject);
  });
}

function waitForState(client, predicate, timeoutMs = 2_000) {
  if (client.state && predicate(client.state)) return Promise.resolve(client.state);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for state')), timeoutMs);
    client.waiters.push({ predicate, resolve, timer });
  });
}

function emitResult(client, event, payload = {}) {
  return new Promise(resolve => client.socket.emit(event, payload, resolve));
}

before(async () => {
  gameServer = createGameServer();
  await new Promise(resolve => gameServer.server.listen(0, '127.0.0.1', resolve));
  const { port } = gameServer.server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  for (const client of clients) client.socket.disconnect();
  for (const room of gameServer.rooms.values()) {
    if (room.answeringTimer) clearTimeout(room.answeringTimer);
    if (room.judgingTimer) clearTimeout(room.judgingTimer);
    if (room.revealTimer) clearTimeout(room.revealTimer);
    for (const player of room.players.values()) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    }
  }
  await new Promise(resolve => gameServer.io.close(resolve));
  if (gameServer.server.listening) {
    await new Promise(resolve => gameServer.server.close(resolve));
  }
});

test('players can complete an anonymous judging round and resume a session', async () => {
  const host = await trackedClient();
  const created = await emitResult(host, 'create-room', { nick: '房主' });
  assert.equal(created.ok, true);

  const guest = await trackedClient();
  const joined = await emitResult(guest, 'join-room', { roomId: created.roomId, nick: '玩家' });
  assert.equal(joined.ok, true);

  const secondGuest = await trackedClient();
  const secondJoined = await emitResult(secondGuest, 'join-room', { roomId: created.roomId, nick: '玩家乙' });
  assert.equal(secondJoined.ok, true);
  await waitForState(host, state => state.players.length === 3);
  await waitForState(guest, state => state.players.length === 3);
  await waitForState(secondGuest, state => state.players.length === 3);

  const started = await emitResult(host, 'start-round');
  assert.equal(started.ok, true);
  const guestRound = await waitForState(guest, state => state.round?.phase === 'answering');
  const secondGuestRound = await waitForState(secondGuest, state => state.round?.phase === 'answering');
  assert.ok(Number.isFinite(guestRound.serverNow));
  assert.equal(guestRound.round.hand.length, 5);
  assert.equal(guestRound.round.expectedCount, 2);
  assert.ok(guestRound.round.answeringEndsAt > Date.now());

  const guestAnswer = guestRound.round.hand[0].text;
  const submitted = await emitResult(guest, 'submit-answer', { cardId: guestRound.round.hand[0].id });
  assert.equal(submitted.ok, true);
  const secondSubmitted = await emitResult(secondGuest, 'submit-answer', {
    cardId: secondGuestRound.round.hand[0].id
  });
  assert.equal(secondSubmitted.ok, true);
  const judging = await waitForState(host, state => state.round?.phase === 'judging');
  assert.equal(judging.round.answers.length, 2);
  assert.ok(judging.round.judgingEndsAt > Date.now());
  for (const answer of judging.round.answers) {
    assert.equal(typeof answer.id, 'string');
    assert.equal('playerId' in answer, false);
    assert.equal('nick' in answer, false);
  }

  const forgedSelection = await emitResult(guest, 'select-winner', { playerId: joined.playerId });
  assert.equal(forgedSelection.ok, false);

  const selectedAnswer = judging.round.answers.find(answer => answer.text === guestAnswer);
  assert.ok(selectedAnswer);
  const selected = await emitResult(host, 'select-winner', { answerId: selectedAnswer.id });
  assert.equal(selected.ok, true);
  const reveal = await waitForState(guest, state => state.round?.phase === 'reveal');
  assert.equal(reveal.round.winner.playerId, joined.playerId);
  assert.equal(reveal.round.answers.length, 2);
  assert.ok(reveal.round.answers.every(answer => answer.playerId && answer.nick));
  const revealedWinner = reveal.round.answers.find(answer => answer.isWinner);
  assert.equal(revealedWinner.playerId, joined.playerId);
  assert.equal(revealedWinner.nick, '玩家');
  assert.equal(reveal.players.find(player => player.id === joined.playerId).score, 1);

  guest.socket.disconnect();
  const resumedGuest = await trackedClient();
  const resumed = await emitResult(resumedGuest, 'resume-room', {
    roomId: joined.roomId,
    sessionToken: joined.sessionToken
  });
  assert.equal(resumed.ok, true);
  const resumedState = await waitForState(resumedGuest, state => state.selfPlayerId === joined.playerId);
  assert.equal(resumedState.players.find(player => player.id === joined.playerId).connected, true);
});

test('uses the first card for unanswered players and randomly selects when the judge times out', async () => {
  const timedServer = createGameServer({ answeringMs: 200, judgingMs: 80, revealMs: 5_000 });
  await new Promise(resolve => timedServer.server.listen(0, '127.0.0.1', resolve));
  const timedUrl = `http://127.0.0.1:${timedServer.server.address().port}`;
  const timedClients = [];

  try {
    const host = await trackedClient(timedUrl);
    const guest = await trackedClient(timedUrl);
    const secondGuest = await trackedClient(timedUrl);
    timedClients.push(host, guest, secondGuest);

    const created = await emitResult(host, 'create-room', { nick: '裁判' });
    const joined = await emitResult(guest, 'join-room', { roomId: created.roomId, nick: '玩家一' });
    const secondJoined = await emitResult(secondGuest, 'join-room', {
      roomId: created.roomId,
      nick: '玩家二'
    });
    await waitForState(host, state => state.players.length === 3);

    assert.equal((await emitResult(host, 'start-round')).ok, true);
    const guestRound = await waitForState(guest, state => state.round?.phase === 'answering');
    const secondGuestRound = await waitForState(secondGuest, state => state.round?.phase === 'answering');
    const manuallySelectedCard = guestRound.round.hand[1];
    const automaticallySelectedCard = secondGuestRound.round.hand[0];
    assert.ok(Number.isFinite(guestRound.round.answeringEndsAt));
    await emitResult(guest, 'submit-answer', { cardId: manuallySelectedCard.id });

    const judging = await waitForState(host, state => state.round?.phase === 'judging');
    assert.equal(judging.round.answers.length, 2);
    assert.deepEqual(
      new Set(judging.round.answers.map(answer => answer.text)),
      new Set([manuallySelectedCard.text, automaticallySelectedCard.text])
    );
    assert.ok(Number.isFinite(judging.round.judgingEndsAt));

    const reveal = await waitForState(host, state => state.round?.phase === 'reveal');
    assert.ok([joined.playerId, secondJoined.playerId].includes(reveal.round.winner.playerId));
    assert.equal(reveal.players.reduce((total, player) => total + player.score, 0), 1);
    assert.ok(reveal.round.answers.every(answer => answer.playerId && answer.nick));
  } finally {
    for (const client of timedClients) client.socket.disconnect();
    for (const room of timedServer.rooms.values()) {
      if (room.answeringTimer) clearTimeout(room.answeringTimer);
      if (room.judgingTimer) clearTimeout(room.judgingTimer);
      if (room.revealTimer) clearTimeout(room.revealTimer);
      for (const player of room.players.values()) {
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      }
    }
    await new Promise(resolve => timedServer.io.close(resolve));
    if (timedServer.server.listening) {
      await new Promise(resolve => timedServer.server.close(resolve));
    }
  }
});
