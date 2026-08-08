const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { createGameServer } = require('../server');

let gameServer;
let baseUrl;
const clients = [];

function trackedClient() {
  const socket = createClient(baseUrl, {
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

test('two players can complete a validated round and resume a session', async () => {
  const host = await trackedClient();
  const created = await emitResult(host, 'create-room', { nick: '房主' });
  assert.equal(created.ok, true);

  const guest = await trackedClient();
  const joined = await emitResult(guest, 'join-room', { roomId: created.roomId, nick: '玩家' });
  assert.equal(joined.ok, true);
  await waitForState(host, state => state.players.length === 2);
  await waitForState(guest, state => state.players.length === 2);

  const started = await emitResult(host, 'start-round');
  assert.equal(started.ok, true);
  const guestRound = await waitForState(guest, state => state.round?.phase === 'answering');
  assert.equal(guestRound.round.hand.length, 5);
  assert.equal(guestRound.round.expectedCount, 1);

  const submitted = await emitResult(guest, 'submit-answer', { cardId: guestRound.round.hand[0].id });
  assert.equal(submitted.ok, true);
  const judging = await waitForState(host, state => state.round?.phase === 'judging');
  assert.equal(judging.round.answers.length, 1);

  const forgedSelection = await emitResult(guest, 'select-winner', { playerId: joined.playerId });
  assert.equal(forgedSelection.ok, false);

  const selected = await emitResult(host, 'select-winner', { playerId: joined.playerId });
  assert.equal(selected.ok, true);
  const reveal = await waitForState(guest, state => state.round?.phase === 'reveal');
  assert.equal(reveal.round.winner.playerId, joined.playerId);
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
