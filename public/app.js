const SESSION_KEY = 'wtf-card-online-session';
const SOUND_KEY = 'wtf-card-sound';
const CHAT_MAX_LENGTH = 120;
const CHAT_EMOJIS = [
  ['😂', '笑哭'], ['🤦', '捂脸'], ['😁', '呲牙'], ['🤭', '捂嘴笑'],
  ['👍', '点赞'], ['🌹', '玫瑰'], ['😭', '大哭'], ['❤️', '红心'],
  ['🤣', '笑翻'], ['😍', '花痴'], ['😊', '微笑'], ['🙏', '谢谢'],
  ['🥰', '喜爱'], ['😅', '流汗笑'], ['👏', '鼓掌'], ['💕', '两颗心'],
  ['😘', '飞吻'], ['🔥', '火'], ['🥺', '可怜'], ['💔', '心碎'],
  ['🤔', '思考'], ['😆', '开心笑'], ['🙄', '白眼'], ['💪', '加油'],
  ['😉', '眨眼'], ['🤗', '抱抱'], ['😎', '酷'], ['🎉', '庆祝'],
  ['✨', '闪亮'], ['😱', '震惊'], ['😋', '好吃'], ['😏', '斜眼笑'],
  ['🤩', '星星眼'], ['😄', '开心'], ['💯', '满分'], ['🙈', '不看'],
  ['👀', '围观'], ['😡', '生气'], ['🤬', '骂人'], ['😳', '脸红'],
  ['😴', '睡觉'], ['💀', '寄'], ['🤡', '小丑'], ['👌', '好的'],
  ['✌️', '胜利'], ['🤓', '书呆子'], ['🍉', '吃瓜'], ['🐶', '狗头']
];
const chatSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('zh', { granularity: 'grapheme' })
  : null;

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
let serverClockOffsetMs = 0;
let clockSynchronized = false;
let clockSyncTimer = null;

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

function splitGraphemes(value) {
  return chatSegmenter
    ? [...chatSegmenter.segment(value)].map(segment => segment.segment)
    : Array.from(value);
}

function closeEmojiPicker() {
  $('emojiPicker').classList.add('hidden');
  $('emojiBtn').setAttribute('aria-expanded', 'false');
}

function insertEmoji(emoji) {
  const input = $('chatInput');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const nextValue = `${input.value.slice(0, start)}${emoji}${input.value.slice(end)}`;
  if (splitGraphemes(nextValue).length > CHAT_MAX_LENGTH) {
    showToast(`消息最多 ${CHAT_MAX_LENGTH} 个字符`, 'warning');
    return;
  }
  input.value = nextValue;
  const cursor = start + emoji.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
}

function renderEmojiPicker() {
  const picker = $('emojiPicker');
  for (const [emoji, label] of CHAT_EMOJIS) {
    const button = node('button', 'emoji-option', emoji);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => insertEmoji(emoji));
    picker.append(button);
  }
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
    } else {
      shell.append(progressStatus(
        round,
        round.submittedBySelf ? '答案已提交，可继续锁定剩余手牌' : '选择一张答案',
        `${round.submittedCount} / ${round.expectedCount} 已提交`
      ));
      const grid = node('div', 'hand-grid');
      const lockedCardCount = round.hand.filter(card => card.locked).length;
      for (const card of round.hand) {
        const cardShell = node('div', `hand-card${card.locked ? ' locked' : ''}`);
        const playButton = node('button', 'white-card', card.text);
        playButton.type = 'button';
        playButton.disabled = round.submittedBySelf;
        playButton.addEventListener('click', () => submitCard(card.id));

        const lockButton = node('button', 'card-lock-btn');
        lockButton.type = 'button';
        const lockLimitReached = !card.locked && lockedCardCount >= 4;
        lockButton.disabled = lockLimitReached;
        lockButton.title = card.locked
          ? '取消保留'
          : lockLimitReached ? '最多保留 4 张牌' : '保留到下一回合';
        lockButton.setAttribute('aria-label', `${lockButton.title}：${card.text}`);
        lockButton.setAttribute('aria-pressed', String(card.locked));
        const lockIcon = node('i');
        lockIcon.dataset.lucide = 'lock';
        lockIcon.setAttribute('aria-hidden', 'true');
        lockButton.append(lockIcon);
        lockButton.addEventListener('click', async () => {
          lockButton.disabled = true;
          const result = await setCardLock(card.id, !card.locked);
          if (!result) lockButton.disabled = false;
        });

        cardShell.append(playButton, lockButton);
        grid.append(cardShell);
      }
      if (round.hasFreeCard && !round.submittedBySelf) {
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
    shell.append(grid);
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
    shell.append(reveal, answerHeading, answerGrid);
    speakReveal(round);
  }

  const countdownByPhase = {
    answering: [round.answeringEndsAt, '秒后未选玩家将自动打出第一张未锁定牌', round.answeringDurationMs],
    judging: [round.judgingEndsAt, '秒后未选择将随机决定胜者', round.judgingDurationMs],
    reveal: [round.winner?.revealEndsAt, '秒后自动进入下一轮', round.winner?.revealDurationMs]
  };
  const [countdownEndsAt, countdownSuffix, countdownDurationMs] = countdownByPhase[round.phase] || [];
  if (Number.isFinite(countdownEndsAt)) {
    const countdown = node('div', 'countdown');
    countdown.id = 'roundCountdown';
    const label = node('div', 'countdown-label');
    label.id = 'roundCountdownLabel';
    const track = node('div', 'countdown-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', '本阶段剩余时间');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = node('div', 'countdown-fill');
    fill.id = 'roundCountdownFill';
    track.append(fill);
    countdown.append(label, track);
    shell.append(countdown);
  }
  stage.append(shell);
  startCountdown(countdownEndsAt, countdownSuffix, countdownDurationMs);
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

async function setCardLock(cardId, locked) {
  const result = await runAction('set-card-lock', { cardId, locked });
  if (result) showToast(locked ? '已保留到下一回合' : '已取消保留', 'success');
  return result;
}

async function selectWinner(answerId) {
  await runAction('select-winner', { answerId });
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function startCountdown(endsAt, suffix, durationMs) {
  stopCountdown();
  if (!Number.isFinite(endsAt) || !Number.isFinite(durationMs)) return;
  const tick = () => {
    const target = $('roundCountdown');
    const label = $('roundCountdownLabel');
    const fill = $('roundCountdownFill');
    const track = fill?.parentElement;
    if (!target || !label || !fill || !track) return stopCountdown();
    const serverNow = Date.now() + serverClockOffsetMs;
    const remainingMs = Math.max(0, endsAt - serverNow);
    const maxSeconds = Math.ceil(durationMs / 1_000);
    const seconds = Math.min(maxSeconds, Math.ceil(remainingMs / 1_000));
    const percent = Math.max(0, Math.min(100, (remainingMs / durationMs) * 100));
    label.textContent = `${seconds} ${suffix}`;
    fill.style.width = `${percent}%`;
    track.setAttribute('aria-valuenow', String(Math.round(percent)));
    target.classList.toggle('warning', seconds <= 10 && seconds > 5);
    target.classList.toggle('urgent', seconds <= 5);
    if (!seconds) stopCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function requestServerTime() {
  return new Promise(resolve => {
    const sentAt = Date.now();
    let settled = false;
    const finish = sample => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(sample);
    };
    const timeout = setTimeout(() => finish(null), 10_000);
    socket.emit('sync-time', {}, response => {
      const receivedAt = Date.now();
      if (!Number.isFinite(response?.serverNow)) return finish(null);
      finish({
        rtt: receivedAt - sentAt,
        offset: response.serverNow - ((sentAt + receivedAt) / 2)
      });
    });
  });
}

async function syncServerClock() {
  const samples = (await Promise.all([
    requestServerTime(),
    requestServerTime(),
    requestServerTime()
  ])).filter(Boolean);
  if (!samples.length) return;
  const bestSample = samples.reduce((best, sample) => sample.rtt < best.rtt ? sample : best);
  serverClockOffsetMs = bestSample.offset;
  clockSynchronized = true;
}

function startClockSync() {
  syncServerClock();
  if (clockSyncTimer) clearInterval(clockSyncTimer);
  clockSyncTimer = setInterval(() => {
    if (socket.connected) syncServerClock();
  }, 30_000);
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
  const unlockUtterance = new SpeechSynthesisUtterance('.');
  activeUtterance = unlockUtterance;
  unlockUtterance.lang = 'zh-CN';
  unlockUtterance.volume = 0;
  const voice = chineseVoice();
  if (voice) unlockUtterance.voice = voice;

  let unlockTimer;
  const finishUnlock = success => {
    if (activeUtterance !== unlockUtterance) return;
    clearTimeout(unlockTimer);
    speechUnlocking = false;
    activeUtterance = null;
    speechUnlocked = success;
    updateSoundButton();
    if (success && pendingSpeechRound) speakReveal(pendingSpeechRound);
  };
  unlockUtterance.onstart = () => {
    speechUnlocked = true;
    updateSoundButton();
  };
  unlockUtterance.onend = () => finishUnlock(true);
  unlockUtterance.onerror = event => {
    finishUnlock(false);
    showToast(`语音启用失败：${event.error || '浏览器拒绝播放'}`, 'warning');
  };
  unlockTimer = setTimeout(() => {
    if (activeUtterance !== unlockUtterance) return;
    if (speechUnlocked) finishUnlock(true);
    else {
      finishUnlock(false);
      showToast('语音引擎没有响应，请使用系统 Safari、Chrome 或 Edge 打开', 'warning');
    }
  }, 3_000);
  window.speechSynthesis.speak(unlockUtterance);
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
  startClockSync();
  resumeSession();
});

socket.on('disconnect', () => {
  setConnectionStatus(false);
  if (clockSyncTimer) clearInterval(clockSyncTimer);
  clockSyncTimer = null;
});
socket.on('connect_error', () => setConnectionStatus(false));
socket.on('state', state => {
  if (!clockSynchronized && Number.isFinite(state.serverNow)) {
    serverClockOffsetMs = state.serverNow - Date.now();
  }
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
  closeEmojiPicker();
  input.value = '';
  const result = await runAction('chat-message', { text });
  if (!result) input.value = text;
});

$('emojiBtn').addEventListener('click', () => {
  const picker = $('emojiPicker');
  const opening = picker.classList.contains('hidden');
  picker.classList.toggle('hidden', !opening);
  $('emojiBtn').setAttribute('aria-expanded', String(opening));
});

$('chatInput').addEventListener('input', event => {
  const graphemes = splitGraphemes(event.target.value);
  if (graphemes.length <= CHAT_MAX_LENGTH) return;
  event.target.value = graphemes.slice(0, CHAT_MAX_LENGTH).join('');
  event.target.setSelectionRange(event.target.value.length, event.target.value.length);
});

document.addEventListener('click', event => {
  if (event.target.closest?.('#emojiBtn, #emojiPicker')) return;
  closeEmojiPicker();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeEmojiPicker();
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
renderEmojiPicker();
