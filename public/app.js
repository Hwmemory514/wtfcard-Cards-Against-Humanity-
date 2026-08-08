const SESSION_KEY = 'wtf-card-online-session';
const SOUND_KEY = 'wtf-card-sound';

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4_000,
  timeout: 10_000
});

const $ = id => document.getElementById(id);
const lobbyView = $('lobbyView');
const gameView = $('gameView');
let lobbyMode = 'create';
let gameState = null;
let session = readSession();
let lastResumeSocketId = null;
let lastSpokenRoundId = null;
let pendingSpeechRound = null;
let speechUnlocked = false;
let speechUnlocking = false;
let activeUtterance = null;
let requestedSpeechRoundId = null;
let speechWarningShown = false;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
let countdownTimer = null;

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { 'stroke-width': 2 } });
}

function emitAck(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(8_000).emit(event, payload, (error, result) => {
      if (error) reject(new Error('服务器响应超时'));
      else if (!result?.ok) reject(new Error(result?.message || '操作失败'));
      else resolve(result);
    });
  });
}

function setConnectionStatus(connected) {
  const lobbyDot = $('lobbyConnectionDot');
  lobbyDot.classList.toggle('online', connected);
  lobbyDot.classList.toggle('offline', !connected);
  $('lobbyConnectionText').textContent = connected ? '服务器已连接' : '服务器连接中断';

  const gameConnection = $('gameConnection');
  gameConnection.classList.toggle('online', connected);
  gameConnection.classList.toggle('offline', !connected);
  gameConnection.querySelector('span:last-child').textContent = connected ? '在线' : '重连中';
}

function setLobbyMode(mode) {
  lobbyMode = mode;
  const creating = mode === 'create';
  $('createModeBtn').classList.toggle('active', creating);
  $('joinModeBtn').classList.toggle('active', !creating);
  $('createModeBtn').setAttribute('aria-selected', String(creating));
  $('joinModeBtn').setAttribute('aria-selected', String(!creating));
  $('createRoomFields').classList.toggle('hidden', !creating);
  $('joinRoomFields').classList.toggle('hidden', creating);
  $('lobbySubmitBtn').querySelector('span').textContent = creating ? '创建房间' : '加入房间';
  $('lobbySubmitBtn').querySelector('i')?.setAttribute('data-lucide', creating ? 'sparkles' : 'log-in');
  $('lobbyError').textContent = '';
  refreshIcons();
}

function showLobby(error = '') {
  lobbyView.classList.remove('hidden');
  gameView.classList.add('hidden');
  $('lobbyError').textContent = error;
  gameState = null;
  stopCountdown();
}

function showGame() {
  lobbyView.classList.add('hidden');
  gameView.classList.remove('hidden');
  refreshIcons();
}

function showToast(text, kind = 'info') {
  if (!text) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = text;
  $('toastRegion').append(toast);
  setTimeout(() => toast.remove(), 3_600);
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(label, icon, handler, secondary = false) {
  const button = node('button', secondary ? 'secondary-btn' : 'primary-btn');
  button.type = 'button';
  const iconNode = node('i');
  iconNode.dataset.lucide = icon;
  iconNode.setAttribute('aria-hidden', 'true');
  button.append(iconNode, node('span', '', label));
  button.addEventListener('click', handler);
  return button;
}

function emptyStage(icon, title, message, action) {
  const wrapper = node('div', 'empty-stage');
  const iconWrap = node('div', 'stage-icon');
  const iconNode = node('i');
  iconNode.dataset.lucide = icon;
  iconWrap.append(iconNode);
  wrapper.append(iconWrap, node('h2', '', title), node('p', '', message));
  if (action) wrapper.append(action);
  return wrapper;
}

function progressStatus(round, title, message) {
  const status = node('div', 'round-status');
  status.append(node('h2', '', title), node('p', '', message));
  const track = node('div', 'progress-track');
  const fill = node('div', 'progress-fill');
  const percent = round.expectedCount ? (round.submittedCount / round.expectedCount) * 100 : 100;
  fill.style.width = `${Math.min(100, percent)}%`;
  track.append(fill);
  status.append(track);
  return status;
}

function renderGameStage() {
  const stage = $('gameStage');
  stopCountdown();
  stage.replaceChildren();
  if (!gameState) return;

  const self = gameState.players.find(player => player.id === gameState.selfPlayerId);
  const judge = gameState.players.find(player => player.id === gameState.judgePlayerId);
  const isJudge = gameState.selfPlayerId === gameState.judgePlayerId;
  const waitingForNextRound = self?.waitingForNextRound;
  const round = gameState.round;

  if (!round) {
    const action = gameState.canStart
      ? actionButton('开始新一轮', 'play', () => runAction('start-round'))
      : null;
    stage.append(emptyStage(
      isJudge ? 'gavel' : 'clock-3',
      isJudge ? '轮到你主持' : '等待裁判开局',
      gameState.players.length < 2 ? '至少需要两名玩家' : `${judge?.nick || '裁判'} 正在准备下一轮`,
      action
    ));
    refreshIcons();
    return;
  }

  const shell = node('div', 'round-shell');
  shell.append(node('div', 'question-card', round.question));

  if (waitingForNextRound) {
    shell.append(progressStatus(round, '本轮观战', '你将在下一轮正式加入'));
  } else if (round.phase === 'answering') {
    if (isJudge) {
      shell.append(progressStatus(round, '等待玩家出牌', `${round.submittedCount} / ${round.expectedCount} 已提交`));
    } else if (round.submittedBySelf) {
      shell.append(progressStatus(round, '答案已提交', `${round.submittedCount} / ${round.expectedCount} 已提交`));
    } else {
      shell.append(progressStatus(round, '选择一张答案', `${round.submittedCount} / ${round.expectedCount} 已提交`));
      const grid = node('div', 'hand-grid');
      for (const card of round.hand) {
        const button = node('button', 'white-card', card.text);
        button.type = 'button';
        button.addEventListener('click', () => submitCard(card.id));
        grid.append(button);
      }
      if (round.hasFreeCard) {
        const freeButton = node('button', 'white-card free-card', '自由卡：输入你的神回复');
        freeButton.type = 'button';
        freeButton.addEventListener('click', () => {
          $('freeAnswerInput').value = '';
          $('freeAnswerDialog').showModal();
          $('freeAnswerInput').focus();
        });
        grid.append(freeButton);
      }
      shell.append(grid);
    }
  } else if (round.phase === 'judging') {
    shell.append(progressStatus(round, isJudge ? '选出本轮赢家' : '等待裁判选择', `${round.answers.length} 个答案`));
    const grid = node('div', 'answers-grid');
    for (const answer of round.answers) {
      const card = node(isJudge ? 'button' : 'div', 'white-card answer-card');
      if (isJudge) {
        card.type = 'button';
        card.addEventListener('click', () => {
          const filledText = round.question.replace(/_+/, answer.text);
          speakSelectedAnswer(filledText, round.id);
          selectWinner(answer.id);
        });
      }
      card.append(node('span', '', answer.text));
      grid.append(card);
    }
    const countdown = node('div', 'countdown');
    countdown.id = 'roundCountdown';
    shell.append(grid, countdown);
    startCountdown(round.judgingEndsAt, '秒后未选择将随机决定胜者');
  } else if (round.phase === 'reveal' && round.winner) {
    const reveal = node('div', 'reveal-card');
    reveal.append(
      node('div', 'winner-label', '本轮最佳答案'),
      node('h2', '', round.winner.filledText),
      node('p', '', `${round.winner.nick} +1 分`)
    );
    const answerHeading = node('h3', 'revealed-answers-heading', '本轮全部答案');
    const answerGrid = node('div', 'answers-grid revealed-answers');
    for (const answer of round.answers) {
      const card = node('div', `white-card answer-card${answer.isWinner ? ' winner-answer' : ''}`);
      card.append(node('span', '', answer.text), node('span', 'answer-owner', answer.nick));
      answerGrid.append(card);
    }
    const countdown = node('div', 'countdown');
    countdown.id = 'roundCountdown';
    shell.append(reveal, answerHeading, answerGrid, countdown);
    startCountdown(round.winner.revealEndsAt, '秒后自动进入下一轮');
    speakReveal(round);
  }

  stage.append(shell);
  refreshIcons();
}

function renderPlayers() {
  const list = $('playerList');
  list.replaceChildren();
  $('playerCount').textContent = gameState?.players.length || 0;
  if (!gameState) return;

  for (const player of gameState.players) {
    const row = node('div', 'player-row');
    if (!player.connected) row.classList.add('disconnected');
    if (player.id === gameState.selfPlayerId) row.classList.add('self');
    const nameWrap = node('div', 'player-name');
    nameWrap.append(document.createTextNode(player.nick));
    const tags = [];
    if (player.id === gameState.hostPlayerId) tags.push('房主');
    if (player.id === gameState.judgePlayerId) tags.push('裁判');
    if (player.waitingForNextRound) tags.push('观战');
    if (tags.length) nameWrap.append(node('span', 'player-tags', ` · ${tags.join(' · ')}`));
    row.append(node('span', 'player-presence'), nameWrap, node('span', 'player-score', `${player.score}分`));
    list.append(row);
  }
}

function renderState() {
  if (!gameState) return;
  showGame();
  $('roomCode').textContent = gameState.roomId;
  const judge = gameState.players.find(player => player.id === gameState.judgePlayerId);
  $('judgeName').textContent = judge?.nick || '等待中';
  $('restartBtn').classList.toggle('hidden', gameState.selfPlayerId !== gameState.hostPlayerId);
  $('announcementDot').classList.toggle('hidden', !gameState.announcement);
  if (!$('announcementDialog').open) $('announcementInput').value = gameState.announcement || '';
  renderPlayers();
  renderGameStage();
  refreshIcons();
}

function appendChat(sender, text) {
  const line = node('div', 'chat-line');
  line.append(node('strong', '', `${sender}:`), document.createTextNode(` ${text}`));
  $('chatMessages').append(line);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
}

function appendNotice(text, kind = 'info') {
  const line = node('div', `chat-line system ${kind}`, text);
  $('chatMessages').append(line);
  $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  showToast(text, kind);
}

async function runAction(event, payload = {}) {
  try {
    return await emitAck(event, payload);
  } catch (error) {
    showToast(error.message, 'error');
    return null;
  }
}

async function submitCard(cardId) {
  const result = await runAction('submit-answer', { cardId });
  if (result) showToast('答案已提交', 'success');
}

async function selectWinner(answerId) {
  await runAction('select-winner', { answerId });
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function startCountdown(endsAt, suffix) {
  stopCountdown();
  if (!Number.isFinite(endsAt)) return;
  const tick = () => {
    const target = $('roundCountdown');
    if (!target) return stopCountdown();
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1_000));
    target.textContent = `${seconds} ${suffix}`;
    if (!seconds) stopCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function speechSupported() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function reportUnsupportedSpeech() {
  if (speechWarningShown) return;
  speechWarningShown = true;
  showToast('当前浏览器不支持语音，请使用系统 Safari、Chrome 或 Edge 打开', 'warning');
}

function chineseVoice() {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(voice => voice.lang.toLowerCase() === 'zh-cn')
    || voices.find(voice => voice.lang.toLowerCase().startsWith('zh'))
    || null;
}

function unlockSpeech() {
  if (!soundEnabled || speechUnlocked || speechUnlocking) return;
  if (!speechSupported()) return reportUnsupportedSpeech();

  speechUnlocking = true;
  window.speechSynthesis.resume();
  const confirmation = new SpeechSynthesisUtterance('语音播报已开启');
  activeUtterance = confirmation;
  confirmation.lang = 'zh-CN';
  const voice = chineseVoice();
  if (voice) confirmation.voice = voice;

  let unlockTimer;
  const finishUnlock = success => {
    if (activeUtterance !== confirmation) return;
    clearTimeout(unlockTimer);
    speechUnlocking = false;
    activeUtterance = null;
    speechUnlocked = success;
    updateSoundButton();
    if (success && pendingSpeechRound) speakReveal(pendingSpeechRound);
  };
  confirmation.onstart = () => {
    speechUnlocked = true;
    updateSoundButton();
  };
  confirmation.onend = () => finishUnlock(true);
  confirmation.onerror = event => {
    finishUnlock(false);
    showToast(`语音启用失败：${event.error || '浏览器拒绝播放'}`, 'warning');
  };
  unlockTimer = setTimeout(() => {
    if (activeUtterance !== confirmation) return;
    if (speechUnlocked) finishUnlock(true);
    else {
      finishUnlock(false);
      showToast('语音引擎没有响应，请使用系统 Safari、Chrome 或 Edge 打开', 'warning');
    }
  }, 3_000);
  window.speechSynthesis.speak(confirmation);
}

function handleSpeechGesture(event) {
  if (gameView.classList.contains('hidden')) return;
  if (event.target.closest?.('#soundBtn, .answer-card')) return;
  unlockSpeech();
  if (pendingSpeechRound) speakReveal(pendingSpeechRound);
}

function speakAnswerText(text, roundId) {
  window.speechSynthesis.resume();
  const utterance = new SpeechSynthesisUtterance(text);
  activeUtterance = utterance;
  requestedSpeechRoundId = roundId;
  utterance.lang = 'zh-CN';
  const voice = chineseVoice();
  if (voice) utterance.voice = voice;
  utterance.onstart = () => {
    lastSpokenRoundId = roundId;
    pendingSpeechRound = null;
  };
  utterance.onerror = () => {
    if (activeUtterance === utterance) activeUtterance = null;
    requestedSpeechRoundId = null;
  };
  utterance.onend = () => {
    if (activeUtterance === utterance) activeUtterance = null;
  };
  window.speechSynthesis.speak(utterance);
}

function speakSelectedAnswer(text, roundId) {
  if (!soundEnabled || lastSpokenRoundId === roundId) return;
  if (!speechSupported()) return reportUnsupportedSpeech();

  speechUnlocked = true;
  speechUnlocking = false;
  updateSoundButton();
  speakAnswerText(text, roundId);
}

function speakReveal(round) {
  if (!soundEnabled
      || lastSpokenRoundId === round.id
      || requestedSpeechRoundId === round.id
      || !speechSupported()) return;
  pendingSpeechRound = round;
  if (!speechUnlocked) return;
  speakAnswerText(round.winner.filledText, round.id);
}

function updateSoundButton() {
  const button = $('soundBtn');
  const currentIcon = button.querySelector('svg, i');
  const icon = node('i');
  icon.dataset.lucide = soundEnabled ? 'volume-2' : 'volume-x';
  icon.setAttribute('aria-hidden', 'true');
  if (currentIcon) currentIcon.replaceWith(icon);
  else button.prepend(icon);
  if (!speechSupported()) button.title = '当前浏览器不支持语音播报';
  else if (soundEnabled && !speechUnlocked) button.title = '点击启用语音播报';
  else button.title = soundEnabled ? '关闭语音播报' : '开启语音播报';
  button.setAttribute('aria-label', button.title);
  button.classList.toggle('accent', soundEnabled && !speechUnlocked && speechSupported());
  refreshIcons();
}

async function resumeSession() {
  if (!session || lastResumeSocketId === socket.id) return;
  lastResumeSocketId = socket.id;
  try {
    await emitAck('resume-room', session);
    showGame();
  } catch (error) {
    saveSession(null);
    showLobby(error.message);
  }
}

socket.on('connect', () => {
  setConnectionStatus(true);
  resumeSession();
});

socket.on('disconnect', () => setConnectionStatus(false));
socket.on('connect_error', () => setConnectionStatus(false));
socket.on('state', state => {
  gameState = state;
  renderState();
});
socket.on('chat-message', message => appendChat(message.sender, message.text));
socket.on('notice', notice => appendNotice(notice.text, notice.kind));

$('createModeBtn').addEventListener('click', () => setLobbyMode('create'));
$('joinModeBtn').addEventListener('click', () => setLobbyMode('join'));

$('lobbyForm').addEventListener('submit', async event => {
  event.preventDefault();
  unlockSpeech();
  $('lobbyError').textContent = '';
  const nick = $('nicknameInput').value.trim();
  const roomId = (lobbyMode === 'create' ? $('customRoomInput').value : $('joinRoomInput').value).trim();
  if (!socket.connected) {
    $('lobbyError').textContent = '服务器尚未连接';
    return;
  }
  const submitButton = $('lobbySubmitBtn');
  submitButton.disabled = true;
  try {
    const result = await emitAck(lobbyMode === 'create' ? 'create-room' : 'join-room', { nick, roomId });
    saveSession({
      roomId: result.roomId,
      playerId: result.playerId,
      sessionToken: result.sessionToken,
      nick
    });
    lastResumeSocketId = socket.id;
    showGame();
    history.replaceState({}, '', `/?room=${encodeURIComponent(result.roomId)}`);
  } catch (error) {
    $('lobbyError').textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

$('copyRoomBtn').addEventListener('click', async () => {
  if (!gameState) return;
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', gameState.roomId);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast('邀请链接已复制', 'success');
  } catch {
    await navigator.clipboard.writeText(gameState.roomId);
    showToast('房间号已复制', 'success');
  }
});

$('leaveBtn').addEventListener('click', async () => {
  await runAction('leave-room');
  saveSession(null);
  history.replaceState({}, '', '/');
  $('chatMessages').replaceChildren();
  showLobby();
});

$('restartBtn').addEventListener('click', () => runAction('restart-game'));

$('chatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const result = await runAction('chat-message', { text });
  if (!result) input.value = text;
});

$('announcementBtn').addEventListener('click', () => {
  if (!gameState) return;
  const isHost = gameState.selfPlayerId === gameState.hostPlayerId;
  $('announcementInput').value = gameState.announcement || '';
  $('announcementInput').readOnly = !isHost;
  $('saveAnnouncementBtn').classList.toggle('hidden', !isHost);
  $('announcementDialog').showModal();
  refreshIcons();
});

$('saveAnnouncementBtn').addEventListener('click', async () => {
  const result = await runAction('update-announcement', { text: $('announcementInput').value });
  if (result) {
    $('announcementDialog').close();
    showToast('公告已保存', 'success');
  }
});

$('freeAnswerForm').addEventListener('submit', async event => {
  event.preventDefault();
  const freeText = $('freeAnswerInput').value.trim();
  if (!freeText) return;
  const result = await runAction('submit-answer', { freeText });
  if (result) {
    $('freeAnswerDialog').close();
    showToast('答案已提交', 'success');
  }
});

$('closeFreeAnswerBtn').addEventListener('click', () => $('freeAnswerDialog').close());

$('soundBtn').addEventListener('click', () => {
  if (soundEnabled && !speechUnlocked) {
    unlockSpeech();
    updateSoundButton();
    return;
  }
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
  if (soundEnabled) {
    unlockSpeech();
    if (gameState?.round?.phase === 'reveal') speakReveal(gameState.round);
  } else if (speechSupported()) {
    pendingSpeechRound = null;
    speechUnlocking = false;
    activeUtterance = null;
    requestedSpeechRoundId = null;
    window.speechSynthesis.cancel();
  }
  updateSoundButton();
});

document.addEventListener('click', handleSpeechGesture, { capture: true });
if (speechSupported()) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    if (pendingSpeechRound) speakReveal(pendingSpeechRound);
  });
}

const roomFromUrl = new URLSearchParams(location.search).get('room');
if (roomFromUrl && !session) {
  $('joinRoomInput').value = roomFromUrl.toUpperCase();
  setLobbyMode('join');
} else {
  setLobbyMode('create');
}

setConnectionStatus(socket.connected);
updateSoundButton();
