// ===== 設定 =====
const GEMINI_LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const API_KEY_ENDPOINT = '/api-key';                // renderサーバ用（相対パス）
const TEXT_GEN_ENDPOINT = '/text-generate';         // renderサーバ用（相対パス）
const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 2048;

// ===== DOM要素 =====
const $ = (id) => document.getElementById(id);
const $status = $('status');
const $start = $('start');
const $stop = $('stop');
const $txt = $('transcript');
const $sum = $('summarize');
const $terms = $('terms');
const $out = $('llmOut');
const $useSystemAudio = $('useSystemAudio');
const $audioDebug = $('audioDebug');
const $micInfo = $('micInfo');
const $sysInfo = $('sysInfo');
const $micLevelBar = $('micLevelBar');
const $sysLevelBar = $('sysLevelBar');
const $currentSpeaker = $('currentSpeaker');
const $saveSession = $('saveSession');
const $viewHistory = $('viewHistory');
const $historyModal = $('historyModal');
const $historyList = $('historyList');
const $closeHistory = $('closeHistory');
const $closeHistoryBtn = $('closeHistoryBtn');
const $configDevices = $('configDevices');
const $deviceModal = $('deviceModal');
const $micDeviceSelect = $('micDeviceSelect');
const $sysDeviceSelect = $('sysDeviceSelect');
const $saveDeviceConfig = $('saveDeviceConfig');
const $cancelDeviceConfig = $('cancelDeviceConfig');
const $resetDevices = $('resetDevices');
const $clearTranscript = $('clearTranscript');
const $copyTranscript = $('copyTranscript');
const $operatorName = $('operatorName');

// ===== 状態管理 =====
let wsMic = null;
let wsSys = null;
let audioContext = null;
let micStream = null;
let sysStream = null;
let micRecorder = null;
let sysRecorder = null;
let currentSessionId = null;
let autoSaveInterval = null;
let micAnalyser = null;
let sysAnalyser = null;
let micDataArray = null;
let sysDataArray = null;
let levelMonitorInterval = null;
let currentMicLevel = 0;
let currentSysLevel = 0;
let transcriptBuffer = [];

// デバッグ用：音声送信とトランスクリプション受信の追跡
let lastMicSendTime = 0;
let lastSysSendTime = 0;
let lastMicTranscriptTime = 0;
let lastSysTranscriptTime = 0;
let micChunksSent = 0;
let sysChunksSent = 0;
let micTranscriptsReceived = 0;
let sysTranscriptsReceived = 0;
let lastMicActivityTime = 0;
let lastSysActivityTime = 0;

// ===== ステータス管理 =====
function setStatus(text, description = '', type = 'ready') {
  const iconMap = {
    ready: 'fa-circle-notch',
    running: 'fa-spinner',
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle'
  };

  const $statusCard = document.getElementById('statusCard');
  const $statusIcon = document.getElementById('statusIcon');
  const $statusTitle = document.getElementById('statusTitle');
  const $statusText = document.getElementById('statusText');

  $statusIcon.querySelector('i').className = `fas ${iconMap[type]}`;
  $statusTitle.textContent = text;
  $statusText.textContent = description;

  updateStatusIcon(type);
}

// ===== ボタン状態管理 =====
function updateButtons(running) {
  $start.disabled = running;
  $stop.disabled = !running;
  const hasText = $txt.value.trim().length > 0;
  $sum.disabled = running || !hasText;
  $terms.disabled = running || !hasText;
  $saveSession.disabled = running || !hasText;
}

// ===== APIキー取得 =====
async function fetchApiKey() {
  const res = await fetch(API_KEY_ENDPOINT, { method: 'POST' });
  if (!res.ok) throw new Error(`APIキー取得に失敗: ${res.status}`);
  const { apiKey } = await res.json();
  if (!apiKey) throw new Error('APIキーレスポンスが不正');
  return apiKey;
}

// ===== 音量レベル計算 =====
function calculateAudioLevel(analyser, dataArray) {
  if (!analyser || !dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const normalized = (dataArray[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / dataArray.length);
}

// ===== 音量モニタリング =====
function monitorAudioLevels() {
  const micLevel = calculateAudioLevel(micAnalyser, micDataArray);
  const sysLevel = calculateAudioLevel(sysAnalyser, sysDataArray);

  currentMicLevel = micLevel;
  currentSysLevel = sysLevel;

  const micPercent = Math.min(100, micLevel * 200);
  const sysPercent = sysAnalyser && sysDataArray ? Math.min(100, sysLevel * 200) : 0;

  $micLevelBar.style.width = micPercent + '%';
  if (sysAnalyser) {
    $sysLevelBar.style.width = sysPercent + '%';
  }

  const threshold = 0.05;
  const micActive = micLevel > threshold;
  const sysActive = sysLevel > threshold;

  let speakerText = '';
  let iconClass = 'fa-user-circle';

  if (micActive && sysActive) {
    speakerText = '両方が同時に発話中（顧客優先）';
    $currentSpeaker.style.color = '#ff9800';
    iconClass = 'fa-users';
  } else if (micActive) {
    speakerText = 'オペレーター（マイク）';
    $currentSpeaker.style.color = 'var(--primary)';
    iconClass = 'fa-user';
  } else if (sysActive) {
    speakerText = '顧客（コラボス）';
    $currentSpeaker.style.color = '#e91e63';
    iconClass = 'fa-phone';
  } else {
    speakerText = '--';
    $currentSpeaker.style.color = 'var(--text-muted)';
  }

  $currentSpeaker.innerHTML = `
    <div class="speaker-indicator">
      <i class="fas ${iconClass}"></i>
    </div>
    <span>現在の話者: ${speakerText}</span>
  `;
}

function startLevelMonitoring() {
  if (levelMonitorInterval) return;
  levelMonitorInterval = setInterval(() => {
    monitorAudioLevels();

    // 定期的な状態チェック（10秒ごと）
    const now = Date.now();
    if (now % 10000 < 100) {
      const micTimeSinceLastSend = lastMicSendTime > 0 ? (now - lastMicSendTime) / 1000 : 0;
      const sysTimeSinceLastSend = lastSysSendTime > 0 ? (now - lastSysSendTime) / 1000 : 0;
      const micTimeSinceLastTranscript = lastMicTranscriptTime > 0 ? (now - lastMicTranscriptTime) / 1000 : 0;
      const sysTimeSinceLastTranscript = lastSysTranscriptTime > 0 ? (now - lastSysTranscriptTime) / 1000 : 0;

      console.log(`%c📊 Status Check:`, 'color: cyan; font-weight: bold');
      console.log(`  [Operator] Sent: ${micChunksSent} chunks, Received: ${micTranscriptsReceived} transcripts, Last send: ${micTimeSinceLastSend.toFixed(1)}s ago, Last transcript: ${micTimeSinceLastTranscript.toFixed(1)}s ago`);
      console.log(`  [Customer] Sent: ${sysChunksSent} chunks, Received: ${sysTranscriptsReceived} transcripts, Last send: ${sysTimeSinceLastSend.toFixed(1)}s ago, Last transcript: ${sysTimeSinceLastTranscript.toFixed(1)}s ago`);

      // 警告：音声送信しているがトランスクリプションが長時間来ない
      if (lastMicActivityTime > 0 && (now - lastMicActivityTime) < 5000 && (now - lastMicTranscriptTime) > 15000 && micChunksSent > 100) {
        console.warn(`%c⚠️ [Operator] Audio being sent but no transcription for ${micTimeSinceLastTranscript.toFixed(1)}s`, 'color: orange; font-weight: bold');
      }
      if (lastSysActivityTime > 0 && (now - lastSysActivityTime) < 5000 && (now - lastSysTranscriptTime) > 15000 && sysChunksSent > 100) {
        console.warn(`%c⚠️ [Customer] Audio being sent but no transcription for ${sysTimeSinceLastTranscript.toFixed(1)}s`, 'color: orange; font-weight: bold');
      }
    }
  }, 100);
  console.log('Audio level monitoring started with status tracking');
}

function stopLevelMonitoring() {
  if (levelMonitorInterval) {
    clearInterval(levelMonitorInterval);
    levelMonitorInterval = null;
    currentMicLevel = 0;
    currentSysLevel = 0;
    $currentSpeaker.innerHTML = `
      <div class="speaker-indicator">
        <i class="fas fa-user-circle"></i>
      </div>
      <span>現在の話者: --</span>
    `;
    $currentSpeaker.style.color = 'var(--text-muted)';
    $micLevelBar.style.width = '0%';
    $sysLevelBar.style.width = '0%';
    console.log('Audio level monitoring stopped');
  }
}

// ===== 文字起こし結果管理 =====
function addTranscript(speaker, text) {
  const timestamp = Date.now();
  transcriptBuffer.push({ timestamp, speaker, text });
  transcriptBuffer.sort((a, b) => a.timestamp - b.timestamp);
  updateTranscriptDisplay();
}

function updateTranscriptDisplay() {
  let displayText = '';
  for (const item of transcriptBuffer) {
    let speakerLabel;
    if (item.speaker === 'operator') {
      const operatorName = $operatorName.value.trim();
      speakerLabel = operatorName ? `[${operatorName}] ` : '[オペレーター] ';
    } else {
      speakerLabel = '[顧客] ';
    }
    displayText += speakerLabel + item.text + '\n';
  }
  $txt.value = displayText;
  $txt.scrollTop = $txt.scrollHeight;
}

// ===== セッション管理 =====
function createSession() {
  currentSessionId = Date.now().toString();
  console.log('Created new session:', currentSessionId);
}

function saveCurrentSession() {
  if (!currentSessionId) return;

  const sessions = JSON.parse(localStorage.getItem('transcriptSessions') || '[]');
  const existingIndex = sessions.findIndex(s => s.id === currentSessionId);

  const session = {
    id: currentSessionId,
    startTime: existingIndex >= 0 ? sessions[existingIndex].startTime : new Date().toISOString(),
    transcript: $txt.value,
    endTime: new Date().toISOString(),
    length: $txt.value.length
  };

  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.unshift(session);
  }

  localStorage.setItem('transcriptSessions', JSON.stringify(sessions.slice(0, 50)));
  console.log('Session saved:', currentSessionId);
  setStatus('保存完了', 'セッションを保存しました', 'success');
}

function startAutoSave() {
  autoSaveInterval = setInterval(() => {
    if ($txt.value.trim().length > 0) {
      saveCurrentSession();
      console.log('Auto-saved at', new Date().toLocaleTimeString());
    }
  }, 10000);
}

function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// ===== デバイス管理 =====
async function listAudioDevices() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    console.log('利用可能なマイクデバイス:', audioInputs);
    return audioInputs;
  } catch (e) {
    console.error('デバイス列挙エラー:', e);
    return [];
  }
}

async function showDeviceConfig() {
  const devices = await listAudioDevices();

  if (devices.length === 0) {
    alert('オーディオデバイスが見つかりません。マイクが接続されているか確認してください。');
    return;
  }

  $micDeviceSelect.innerHTML = '<option value="">デバイスを選択...</option>';
  $sysDeviceSelect.innerHTML = '<option value="">デバイスを選択...</option><option value="NONE">使用しない</option>';

  devices.forEach(device => {
    const option1 = document.createElement('option');
    option1.value = device.deviceId;
    option1.textContent = device.label || `マイク ${device.deviceId.substring(0, 8)}`;
    $micDeviceSelect.appendChild(option1);

    const option2 = document.createElement('option');
    option2.value = device.deviceId;
    option2.textContent = device.label || `マイク ${device.deviceId.substring(0, 8)}`;
    $sysDeviceSelect.appendChild(option2);
  });

  const savedMicDeviceId = localStorage.getItem('micDeviceId');
  const savedSysDeviceId = localStorage.getItem('sysDeviceId');

  if (savedMicDeviceId) $micDeviceSelect.value = savedMicDeviceId;
  if (savedSysDeviceId) $sysDeviceSelect.value = savedSysDeviceId;

  $deviceModal.style.display = 'block';
}

function saveDeviceConfig() {
  const micDeviceId = $micDeviceSelect.value;
  const sysDeviceId = $sysDeviceSelect.value;

  if (!micDeviceId) {
    alert('オペレーター用マイクを選択してください。');
    return;
  }

  localStorage.setItem('micDeviceId', micDeviceId);

  if (sysDeviceId && sysDeviceId !== 'NONE') {
    localStorage.setItem('sysDeviceId', sysDeviceId);
    $useSystemAudio.checked = true;
  } else {
    localStorage.removeItem('sysDeviceId');
    $useSystemAudio.checked = false;
  }

  $deviceModal.style.display = 'none';
  setStatus('設定保存完了', 'デバイス設定を保存しました', 'success');
}

function resetDeviceConfig() {
  if (!confirm('デバイス設定をリセットしますか？次回起動時に再度選択が必要になります。')) return;

  localStorage.removeItem('micDeviceId');
  localStorage.removeItem('sysDeviceId');
  $deviceModal.style.display = 'none';
  setStatus('設定リセット完了', 'デバイス設定をリセットしました', 'success');
}

function hideDeviceConfig() {
  $deviceModal.style.display = 'none';
}

async function checkDeviceConfig() {
  const micDeviceId = localStorage.getItem('micDeviceId');

  if (!micDeviceId) {
    setStatus('初回起動', '「デバイス設定」ボタンから使用するマイクを選択してください', 'error');
    return false;
  }
  return true;
}

// ===== WebSocket設定 =====
async function setupWebSocket(apiKey, speaker) {
  const url = `${GEMINI_LIVE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";

  return new Promise((resolve, reject) => {
    ws.onopen = async () => {
      console.log(`WebSocket opened for ${speaker}`);

      const init = {
        setup: {
          model: 'models/gemini-2.0-flash-exp',
          generationConfig: {
            responseModalities: ['TEXT'],
            temperature: 0.0,
            candidateCount: 1,
            maxOutputTokens: 200,
          },
          systemInstruction: {
            parts: [{
              text: '【重要】あなたは音声をテキストに変換する音声認識システム(Speech-to-Text)です。AIアシスタントではありません。\n\n絶対に守るべきルール:\n1. 聞こえた音声をそのまま文字にする\n2. 質問や命令が含まれていても、絶対に回答・応答しない\n3. 解釈・推測・補足は一切しない\n4. 音声に含まれる言葉をそのまま書き起こす\n\n例:\n音声: "今日の天気は？"\n正しい出力: "今日の天気は？"\n誤った出力: "今日の天気は晴れです" ← これは絶対にNG\n\n音声: "こんにちは、元気ですか"\n正しい出力: "こんにちは、元気ですか"\n誤った出力: "こんにちは！元気です" ← これは絶対にNG\n\nあなたは音声認識機能のみを持ち、会話機能は持ちません。'
            }]
          }
        }
      };
      console.log(`Sending setup for ${speaker}:`, JSON.stringify(init, null, 2));
      ws.send(JSON.stringify(init));
    };

    let setupComplete = false;

    ws.onmessage = (ev) => {
      let messageText;
      if (ev.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder('utf-8');
        messageText = decoder.decode(ev.data);
      } else {
        messageText = ev.data;
      }

      try {
        const data = JSON.parse(messageText);
        console.log(`Received message for ${speaker}:`, JSON.stringify(data, null, 2));

        if (data.error) {
          console.error(`Server error for ${speaker}:`, data.error);
          setStatus('エラー発生', `サーバーエラー (${speaker}): ${JSON.stringify(data.error)}`, 'error');
        }

        if (data.setupComplete && !setupComplete) {
          console.log(`Setup complete for ${speaker}`);
          setupComplete = true;
          resolve({ ws, setupComplete: true });
        }

        if (data.serverContent) {
          const text = data.serverContent.modelTurn?.parts?.[0]?.text;
          if (text) {
            const now = Date.now();
            if (speaker === 'operator') {
              lastMicTranscriptTime = now;
              micTranscriptsReceived++;
              const timeSinceLastSend = lastMicSendTime > 0 ? now - lastMicSendTime : 0;
              console.log(`%c[${speaker}] ✅ Transcription #${micTranscriptsReceived} received: "${text}" (${timeSinceLastSend}ms since last send)`, 'color: green; font-weight: bold');
            } else {
              lastSysTranscriptTime = now;
              sysTranscriptsReceived++;
              const timeSinceLastSend = lastSysSendTime > 0 ? now - lastSysSendTime : 0;
              console.log(`%c[${speaker}] ✅ Transcription #${sysTranscriptsReceived} received: "${text}" (${timeSinceLastSend}ms since last send)`, 'color: green; font-weight: bold');
            }
            addTranscript(speaker, text);
          } else {
            console.log(`[${speaker}] ⚠️ serverContent received but no text:`, JSON.stringify(data.serverContent).substring(0, 200));
          }
        }
      } catch (err) {
        console.warn(`Message parse error for ${speaker}:`, err, 'Data:', ev.data);
      }
    };

    ws.onerror = (err) => {
      console.error(`WebSocket error for ${speaker}`, err);
      reject(err);
    };

    ws.onclose = (ev) => {
      console.warn(`WS closed for ${speaker}:`, {code: ev.code, reason: ev.reason});
    };
  });
}

// ===== 音声処理 =====
function setupAudioProcessor(stream, ws, speaker, channelCount = 1) {
  console.log(`[${speaker}] Setting up audio processor...`);
  console.log(`[${speaker}] Stream tracks:`, stream.getAudioTracks());
  console.log(`[${speaker}] WebSocket state:`, ws?.readyState);

  const source = audioContext.createMediaStreamSource(stream);
  console.log(`[${speaker}] MediaStreamSource created`);

  const inputGainNode = audioContext.createGain();
  if (speaker === 'customer') {
    inputGainNode.gain.value = 1.5;
    console.log(`[${speaker}] Input gain set to 1.5x for better recognition`);
  } else {
    inputGainNode.gain.value = 1.0;
  }
  source.connect(inputGainNode);

  let recorder;
  try {
    recorder = audioContext.createScriptProcessor(CHUNK_SIZE, channelCount, 1);
    console.log(`[${speaker}] ScriptProcessor created with CHUNK_SIZE=${CHUNK_SIZE}`);
  } catch (e) {
    recorder = audioContext.createScriptProcessor(2048, channelCount, 1);
    console.log(`[${speaker}] ScriptProcessor created with fallback size=2048`);
  }

  inputGainNode.connect(recorder);
  console.log(`[${speaker}] InputGain connected to recorder`);

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0;
  recorder.connect(gainNode);
  gainNode.connect(audioContext.destination);
  console.log(`[${speaker}] Connected to destination with zero gain (silent)`);

  let audioChunkCount = 0;
  let lastAudioLevel = 0;
  let silentChunks = 0;
  const SILENT_THRESHOLD = 0.01;
  const LONG_SILENCE_CHUNKS = 500; // 約10秒（20ms * 500）

  recorder.onaudioprocess = (e) => {
    if (audioChunkCount === 0) {
      console.log(`%c[${speaker}] 🎬 onaudioprocess started`, 'color: blue; font-weight: bold');
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (audioChunkCount === 0 || audioChunkCount % 100 === 0) {
        console.warn(`%c[${speaker}] ⚠️ WebSocket not ready. State: ${ws?.readyState}`, 'color: orange; font-weight: bold');
      }
      return;
    }

    // 顧客が話している間はオペレーターの音声送信をスキップ（顧客優先）
    const PRIORITY_THRESHOLD = 0.03;
    if (speaker === 'operator' && currentSysLevel > PRIORITY_THRESHOLD) {
      if (audioChunkCount % 100 === 0) {
        console.log(`%c[${speaker}] ⏸️ Skipping operator audio (customer priority active, sysLevel=${currentSysLevel.toFixed(4)})`, 'color: gray');
      }
      return;
    }

    const inputChannels = e.inputBuffer.numberOfChannels;
    const len = e.inputBuffer.length;
    const pcm16 = new Int16Array(len);

    let maxAmplitude = 0;
    if (inputChannels === 2) {
      const ch0 = e.inputBuffer.getChannelData(0);
      const ch1 = e.inputBuffer.getChannelData(1);
      for (let i = 0; i < len; i++) {
        const mixed = (ch0[i] + ch1[i]) / 2;
        const s = Math.max(-1, Math.min(1, mixed));
        pcm16[i] = (s * 0x7fff) | 0;
        maxAmplitude = Math.max(maxAmplitude, Math.abs(s));
      }
      if (audioChunkCount === 0) {
        console.log(`[${speaker}] Stereo audio detected, mixing both channels`);
      }
    } else {
      const ch0 = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const s = Math.max(-1, Math.min(1, ch0[i]));
        pcm16[i] = (s * 0x7fff) | 0;
        maxAmplitude = Math.max(maxAmplitude, Math.abs(s));
      }
      if (audioChunkCount === 0) {
        console.log(`[${speaker}] Mono audio detected`);
      }
    }

    const uint8Array = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Audio = btoa(binary);

    // 音声レベルの変化を検出
    const isCurrentlySilent = maxAmplitude < SILENT_THRESHOLD;
    const wasSilent = lastAudioLevel < SILENT_THRESHOLD;

    if (isCurrentlySilent) {
      silentChunks++;
      // 長時間無音後の警告
      if (silentChunks === LONG_SILENCE_CHUNKS) {
        console.log(`%c[${speaker}] 🔇 Long silence detected (>10 seconds)`, 'color: orange; font-weight: bold');
      }
    } else {
      // 音声が再開された
      if (wasSilent && silentChunks >= LONG_SILENCE_CHUNKS) {
        const now = Date.now();
        const lastSendTime = speaker === 'operator' ? lastMicSendTime : lastSysSendTime;
        const timeSinceLastSend = lastSendTime > 0 ? now - lastSendTime : 0;
        console.log(`%c[${speaker}] 🔊 Audio resumed after long silence (${(silentChunks * 20 / 1000).toFixed(1)}s), last send was ${(timeSinceLastSend / 1000).toFixed(1)}s ago`, 'color: lime; font-weight: bold');
      }
      silentChunks = 0;
    }
    lastAudioLevel = maxAmplitude;

    const audioMsg = {
      realtimeInput: {
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64Audio
        }
      }
    };

    try {
      ws.send(JSON.stringify(audioMsg));

      // 送信成功時の記録
      const now = Date.now();
      if (speaker === 'operator') {
        lastMicSendTime = now;
        micChunksSent++;
        if (maxAmplitude > SILENT_THRESHOLD) {
          lastMicActivityTime = now;
        }
      } else {
        lastSysSendTime = now;
        sysChunksSent++;
        if (maxAmplitude > SILENT_THRESHOLD) {
          lastSysActivityTime = now;
        }
      }

      audioChunkCount++;
      if (audioChunkCount <= 10 || audioChunkCount % 50 === 0) {
        const lastTranscriptTime = speaker === 'operator' ? lastMicTranscriptTime : lastSysTranscriptTime;
        const timeSinceLastTranscript = lastTranscriptTime > 0 ? now - lastTranscriptTime : 0;
        console.log(`[${speaker}] 📤 Sent chunk #${audioChunkCount}: size=${pcm16.buffer.byteLength}B, maxAmp=${maxAmplitude.toFixed(4)}, wsState=${ws.readyState}, lastTranscript=${(timeSinceLastTranscript / 1000).toFixed(1)}s ago`);
      }

      if (speaker === 'customer' && audioChunkCount % 10 === 0) {
        console.log(`%c[customer] 🔊 Audio streaming: chunk ${audioChunkCount}, amp=${maxAmplitude.toFixed(4)}`, 'color: #e91e63; font-weight: bold');
      }
    } catch (error) {
      console.error(`%c[${speaker}] ❌ WebSocket send error:`, 'color: red; font-weight: bold', error);
    }
  };

  return { source, recorder, gainNode, inputGainNode };
}

// ===== 文字起こし開始 =====
async function startTranscription() {
  const hasConfig = await checkDeviceConfig();
  if (!hasConfig) {
    alert('まず「デバイス設定」ボタンから使用するマイクを選択してください。');
    return;
  }

  setStatus('起動中...', '音声ストリームを取得しています', 'running');
  updateButtons(true);
  $out.innerHTML = '';
  $txt.value = '';
  transcriptBuffer = [];

  createSession();
  startAutoSave();

  // デバッグカウンターをリセット
  lastMicSendTime = 0;
  lastSysSendTime = 0;
  lastMicTranscriptTime = 0;
  lastSysTranscriptTime = 0;
  micChunksSent = 0;
  sysChunksSent = 0;
  micTranscriptsReceived = 0;
  sysTranscriptsReceived = 0;
  lastMicActivityTime = 0;
  lastSysActivityTime = 0;

  console.log('Auto-save enabled: 別タブで作業中でも10秒ごとに自動保存されます');
  console.log('%c🔍 デバッグモード: 詳細なログが有効になっています', 'color: cyan; font-weight: bold');

  try {
    $audioDebug.style.display = 'block';

    const useSystemAudio = $useSystemAudio.checked;
    const savedMicDeviceId = localStorage.getItem('micDeviceId');
    const savedSysDeviceId = localStorage.getItem('sysDeviceId');

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: savedMicDeviceId } },
      video: false
    });

    const micTrack = micStream.getAudioTracks()[0];
    $micInfo.textContent = `マイク: ${micTrack.label || '接続済み'} (デバイスID: ${micTrack.id.substring(0, 8)}...)`;
    console.log('Microphone track:', micTrack);

    if (useSystemAudio && savedSysDeviceId) {
      setStatus('起動中...', 'システム音声デバイスを取得しています', 'running');
      console.log(`%c🔍 Attempting to get customer audio device: ${savedSysDeviceId}`, 'color: purple; font-weight: bold');
      try {
        sysStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: savedSysDeviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          },
          video: false
        });

        const sysTrack = sysStream.getAudioTracks()[0];
        $sysInfo.textContent = `システム音声: ${sysTrack.label || '接続済み'}`;
        console.log(`%c✅ System audio track acquired successfully:`, 'color: green; font-weight: bold', {
          label: sysTrack.label,
          id: sysTrack.id,
          enabled: sysTrack.enabled,
          muted: sysTrack.muted,
          readyState: sysTrack.readyState,
          settings: sysTrack.getSettings()
        });
      } catch (e) {
        console.error('%c❌ 顧客音声用デバイスの取得に失敗:', 'color: red; font-weight: bold', e);
        setStatus('警告', 'システム音声の取得に失敗。マイクのみで続行します', 'error');
        $sysInfo.textContent = 'システム音声: 取得失敗';
        sysStream = null;
      }
    } else {
      console.log(`ℹ️ System audio disabled. useSystemAudio=${useSystemAudio}, savedSysDeviceId=${savedSysDeviceId}`);
      $sysInfo.textContent = 'システム音声: 使用しない';
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });

    const micSrc = audioContext.createMediaStreamSource(micStream);
    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    micDataArray = new Uint8Array(micAnalyser.frequencyBinCount);
    micSrc.connect(micAnalyser);

    if (sysStream && sysStream.getAudioTracks().length > 0) {
      console.log('%c🔊 Setting up system audio analyser...', 'color: purple; font-weight: bold');
      const sysSrc = audioContext.createMediaStreamSource(sysStream);
      sysAnalyser = audioContext.createAnalyser();
      sysAnalyser.fftSize = 256;
      sysDataArray = new Uint8Array(sysAnalyser.frequencyBinCount);
      sysSrc.connect(sysAnalyser);
      console.log('%c✅ System audio analyser connected', 'color: green; font-weight: bold');
    } else {
      console.log('%c⚠️ System audio analyser NOT created (no stream)', 'color: orange; font-weight: bold');
    }

    const apiKey = await fetchApiKey();

    setStatus('接続中...', 'マイク用の接続を作成しています', 'running');
    const { ws: micWs } = await setupWebSocket(apiKey, 'operator');
    wsMic = micWs;

    if (sysStream && sysStream.getAudioTracks().length > 0) {
      setStatus('接続中...', 'システム音声用の接続を作成しています', 'running');
      console.log('%c🌐 Creating WebSocket for customer audio...', 'color: purple; font-weight: bold');
      const { ws: sysWs } = await setupWebSocket(apiKey, 'customer');
      wsSys = sysWs;
      console.log('%c✅ Customer WebSocket created, readyState:', 'color: green; font-weight: bold', wsSys.readyState);
    } else {
      console.log('%c⚠️ Skipping customer WebSocket (no stream)', 'color: orange; font-weight: bold');
    }

    try { await audioContext.resume(); } catch {}

    const { recorder: micRec } = setupAudioProcessor(micStream, wsMic, 'operator');
    micRecorder = micRec;

    if (sysStream && sysStream.getAudioTracks().length > 0) {
      console.log('%c🎙️ Setting up customer audio processor...', 'color: purple; font-weight: bold');
      const { recorder: sysRec } = setupAudioProcessor(sysStream, wsSys, 'customer');
      sysRecorder = sysRec;
      console.log('%c✅ Customer audio processor ready', 'color: green; font-weight: bold');
    } else {
      console.log('%c⚠️ Skipping customer audio processor (no stream)', 'color: orange; font-weight: bold');
    }

    startLevelMonitoring();

    setStatus('文字起こし中...', '2つの音声ソースが独立して処理されています', 'running');
  } catch (e) {
    console.error('startTranscription error', e);
    const msg = (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError')
      ? 'マイクへのアクセス許可が必要です。ページを再読み込みして許可してください。'
      : `初期化エラー: ${e?.message || e}`;
    setStatus('エラー', msg, 'error');
    updateButtons(false);
  }
}

// ===== 文字起こし停止 =====
function stopTranscription() {
  setStatus('停止中...', '処理を終了しています', 'running');

  stopAutoSave();
  if ($txt.value.trim().length > 0) {
    saveCurrentSession();
  }

  stopLevelMonitoring();

  try { wsMic?.close(1000, 'user close'); } catch(_){}
  wsMic = null;
  try { wsSys?.close(1000, 'user close'); } catch(_){}
  wsSys = null;

  try { micRecorder?.disconnect(); } catch(_){}
  micRecorder = null;
  try { sysRecorder?.disconnect(); } catch(_){}
  sysRecorder = null;

  try { audioContext?.close(); } catch(_){}
  audioContext = null;

  try { micStream?.getTracks().forEach(t => t.stop()); } catch(_){}
  micStream = null;

  try { sysStream?.getTracks().forEach(t => t.stop()); } catch(_){}
  sysStream = null;

  micAnalyser = null;
  sysAnalyser = null;
  micDataArray = null;
  sysDataArray = null;

  $audioDebug.style.display = 'none';
  $micInfo.textContent = 'マイク: 未接続';
  $sysInfo.textContent = 'システム音声: 未接続';

  setStatus('停止完了', '文字起こし結果を自動保存しました。分析機能を使えます', 'success');
  updateButtons(false);
}

// ===== テキスト生成 =====
async function callTextGen(systemInstruction, userQuery, model = 'gemini-2.0-flash-exp') {
  const payload = { systemInstruction, userQuery, model };
  console.log('Calling text generation API:', TEXT_GEN_ENDPOINT);
  console.log('Payload:', payload);

  try {
    const res = await fetch(TEXT_GEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log('Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Error response:', errorText);
      throw new Error(`テキスト生成に失敗: ${res.status} - ${errorText.substring(0, 200)}`);
    }

    const data = await res.json();
    console.log('Response data:', data);
    return data.text || '';
  } catch (e) {
    console.error('Text generation error:', e);
    throw e;
  }
}

// ===== 要約生成 =====
async function summarize() {
  const t = $txt.value.trim();
  if (!t) {
    alert('文字起こしテキストが空です。');
    return;
  }

  const operatorName = $operatorName.value.trim() || '担当者';

  $sum.disabled = $terms.disabled = true;
  $out.innerHTML = '<h3><i class="fas fa-magic"></i> 要約結果</h3><pre>✨ 要約を生成中...</pre>';

  try {
    const sys = `あなたはプロのサマライザーです。提供された日本語の会議または会話の文字起こしを読み、主要な論点、決定事項、次のステップを含む簡潔な箇条書きの要約を日本語で作成してください。要約の先頭には必ず「担当者: ${operatorName}」を追加してください。`;
    const uq = `以下の文字起こしを要約してください:\n\n---\n${t}`;
    console.log('Starting summarization...');
    const text = await callTextGen(sys, uq);
    $out.innerHTML = `<h3><i class="fas fa-magic"></i> 要約結果</h3><pre>${text}</pre>`;
    setStatus('要約完了', '要約が正常に生成されました', 'success');
  } catch (e) {
    console.error('Summarization error:', e);
    const errorMsg = e?.message || String(e);
    $out.innerHTML = `<h3><i class="fas fa-exclamation-triangle"></i> エラー</h3><pre style="color:#c62828">要約エラー: ${errorMsg}\n\nブラウザのコンソール（F12）で詳細を確認してください。</pre>`;
    setStatus('要約失敗', 'コンソールを確認してください', 'error');
  } finally {
    updateButtons(false);
  }
}

// ===== 専門用語チェック =====
async function terms() {
  const t = $txt.value.trim();
  if (!t) {
    alert('文字起こしテキストが空です。');
    return;
  }

  $sum.disabled = $terms.disabled = true;
  $out.innerHTML = '<h3><i class="fas fa-book"></i> 専門用語分析結果</h3><pre>✨ 専門用語を分析中...</pre>';

  try {
    const sys = 'あなたは学術的なアシスタントです。提供された日本語のテキストから、専門的/技術的な用語を最大5つ抽出し、非専門家にも分かる簡潔で正確な日本語の説明を出力してください。出力は「【用語】: 説明文」の箇条書き。';
    const uq = `以下の文字起こしから専門用語を抽出し、説明してください:\n\n---\n${t}`;
    console.log('Starting term extraction...');
    const text = await callTextGen(sys, uq);
    $out.innerHTML = `<h3><i class="fas fa-book"></i> 専門用語分析結果</h3><pre>${text}</pre>`;
    setStatus('分析完了', '専門用語分析が正常に完了しました', 'success');
  } catch (e) {
    console.error('Term extraction error:', e);
    const errorMsg = e?.message || String(e);
    $out.innerHTML = `<h3><i class="fas fa-exclamation-triangle"></i> エラー</h3><pre style="color:#c62828">専門用語分析エラー: ${errorMsg}\n\nブラウザのコンソール（F12）で詳細を確認してください。</pre>`;
    setStatus('分析失敗', 'コンソールを確認してください', 'error');
  } finally {
    updateButtons(false);
  }
}

// ===== 履歴表示 =====
function showHistory() {
  const sessions = JSON.parse(localStorage.getItem('transcriptSessions') || '[]');

  if (sessions.length === 0) {
    $historyList.innerHTML = '<div class="history-empty"><i class="fas fa-inbox"></i><p>保存されたセッションはありません。</p></div>';
  } else {
    let html = '<div class="history-list">';
    sessions.forEach((session, index) => {
      const startDate = new Date(session.startTime);
      const endDate = session.endTime ? new Date(session.endTime) : null;
      const duration = endDate ? Math.round((endDate - startDate) / 1000) : null;

      html += `
        <div class="history-item">
          <div class="history-item-header">
            <div>
              <div class="history-item-title">セッション ${index + 1}</div>
              <div class="history-item-meta">
                ${startDate.toLocaleString('ja-JP')}
                ${duration ? `(${duration}秒)` : ''}
              </div>
            </div>
            <div class="history-item-actions">
              <button class="btn btn-secondary" onclick="loadSession('${session.id}')">
                <i class="fas fa-download"></i> 読み込み
              </button>
              <button class="btn btn-danger" onclick="deleteSession('${session.id}')">
                <i class="fas fa-trash"></i> 削除
              </button>
            </div>
          </div>
          <div class="history-item-info">
            <i class="fas fa-file-alt"></i> 文字数: ${session.length || session.transcript.length}文字
          </div>
          <div class="history-item-preview">
            ${session.transcript.substring(0, 200)}${session.transcript.length > 200 ? '...' : ''}
          </div>
        </div>
      `;
    });
    html += '</div>';
    $historyList.innerHTML = html;
  }

  $historyModal.style.display = 'block';
}

function hideHistory() {
  $historyModal.style.display = 'none';
}

window.loadSession = function(sessionId) {
  const sessions = JSON.parse(localStorage.getItem('transcriptSessions') || '[]');
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    $txt.value = session.transcript;
    updateButtons(false);
    hideHistory();
    setStatus('読み込み完了', 'セッションを読み込みました', 'success');
  }
};

window.deleteSession = function(sessionId) {
  if (!confirm('このセッションを削除しますか？')) return;

  const sessions = JSON.parse(localStorage.getItem('transcriptSessions') || '[]');
  const filtered = sessions.filter(s => s.id !== sessionId);
  localStorage.setItem('transcriptSessions', JSON.stringify(filtered));
  showHistory();
  setStatus('削除完了', 'セッションを削除しました', 'success');
};

// ===== ユーティリティ機能 =====
function clearTranscript() {
  if ($txt.value.trim().length === 0) return;
  if (!confirm('文字起こし結果をクリアしますか？')) return;
  $txt.value = '';
  transcriptBuffer = [];
  updateButtons(false);
  setStatus('クリア完了', '文字起こし結果をクリアしました', 'success');
}

function copyTranscript() {
  if ($txt.value.trim().length === 0) {
    alert('コピーするテキストがありません。');
    return;
  }

  navigator.clipboard.writeText($txt.value).then(() => {
    setStatus('コピー完了', 'クリップボードにコピーしました', 'success');
    setTimeout(() => {
      setStatus('準備完了', '「文字起こし開始」ボタンをクリックしてください', 'ready');
    }, 2000);
  }).catch(err => {
    console.error('Copy failed:', err);
    alert('コピーに失敗しました。');
  });
}

// ===== テーマ切り替え =====
function initThemeSwitcher() {
  const savedTheme = localStorage.getItem('appTheme') || 'blue';
  document.body.setAttribute('data-theme', savedTheme);

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      document.body.setAttribute('data-theme', theme);
      localStorage.setItem('appTheme', theme);

      btn.style.transform = 'scale(1.2)';
      setTimeout(() => {
        btn.style.transform = 'scale(1)';
      }, 200);
    });
  });
}

// ===== ステータスアイコン更新 =====
function updateStatusIcon(state) {
  const $statusIcon = document.querySelector('#statusIcon');

  $statusIcon.classList.remove('spinning');

  if (state === 'running') {
    $statusIcon.classList.add('spinning');
  }
}

// ===== 担当者名の保存と読み込み =====
function saveOperatorName() {
  const name = $operatorName.value.trim();
  if (name) {
    localStorage.setItem('operatorName', name);
  }
}

function loadOperatorName() {
  const savedName = localStorage.getItem('operatorName');
  if (savedName) {
    $operatorName.value = savedName;
  }
}

// ===== イベントリスナー =====
$start.addEventListener('click', startTranscription);
$stop.addEventListener('click', stopTranscription);
$sum.addEventListener('click', summarize);
$terms.addEventListener('click', terms);
$saveSession.addEventListener('click', saveCurrentSession);
$viewHistory.addEventListener('click', showHistory);
$closeHistory.addEventListener('click', hideHistory);
$closeHistoryBtn.addEventListener('click', hideHistory);
$configDevices.addEventListener('click', showDeviceConfig);
$saveDeviceConfig.addEventListener('click', saveDeviceConfig);
$cancelDeviceConfig.addEventListener('click', hideDeviceConfig);
$resetDevices.addEventListener('click', resetDeviceConfig);
$clearTranscript.addEventListener('click', clearTranscript);
$copyTranscript.addEventListener('click', copyTranscript);
$operatorName.addEventListener('input', () => {
  saveOperatorName();
  // 担当者名が変更されたら文字起こし結果の表示も更新
  if (transcriptBuffer.length > 0) {
    updateTranscriptDisplay();
  }
});

// モーダルの背景クリックで閉じる
$historyModal.addEventListener('click', (e) => {
  if (e.target === $historyModal || e.target.classList.contains('modal-overlay')) {
    hideHistory();
  }
});

$deviceModal.addEventListener('click', (e) => {
  if (e.target === $deviceModal || e.target.classList.contains('modal-overlay')) {
    hideDeviceConfig();
  }
});

// ===== 初期化 =====
initThemeSwitcher();
loadOperatorName();
updateButtons(false);
checkDeviceConfig();
