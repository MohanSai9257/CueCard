const $ = (selector) => document.querySelector(selector);

const MODELS = Object.fromEntries(
  Object.entries(window.CueProviders)
    .filter(([, provider]) => provider.models)
    .map(([id, provider]) => [id, provider.models]),
);

const setupView = $('#setupView');
const interviewView = $('#interviewView');
const providerEl = $('#provider');
const modelEl = $('#model');
const answerEl = $('#answer');
const questionEl = $('#question');
const statusEl = $('#status');
const isOverlay = new URLSearchParams(location.search).has('overlay');
const opacityInput = $('#panelOpacity');
function setPanelOpacity(value) {
  const number = Number(value);
  const opacity = Number.isFinite(number) ? Math.max(10, Math.min(95, number)) : 30;
  document.body.style.setProperty('--overlay-opacity', String(opacity / 100));
  opacityInput.value = String(opacity);
  $('#opacityValue').textContent = `${opacity}%`;
}
if (isOverlay) {
  try {
    setPanelOpacity(localStorage.getItem('cuecard.overlay.opacity') ?? 30);
  } catch {
    setPanelOpacity(30);
  }
}
opacityInput.addEventListener('input', () => {
  setPanelOpacity(opacityInput.value);
  try {
    localStorage.setItem('cuecard.overlay.opacity', opacityInput.value);
  } catch {
    /* Preference persistence is optional. */
  }
});
function closeAppearance() {
  $('#appearancePanel').classList.add('hidden');
  $('#appearanceBtn').setAttribute('aria-expanded', 'false');
}
$('#appearanceBtn').addEventListener('click', () => {
  const hidden = $('#appearancePanel').classList.toggle('hidden');
  $('#appearanceBtn').setAttribute('aria-expanded', String(!hidden));
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('#appearancePanel, #appearanceBtn')) closeAppearance();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAppearance();
});

let resume = null;
let resumeSessionId = null;
let config = null;
let stream = null;
let systemStream = null;
let nativeSystemDestination = null;
let removeSystemAudioListener = null;
let removeSystemErrorListener = null;
let nativeAudioTime = 0;
let micStream = null;
let recorder = null;
let chunks = [];
let audioContext = null;
let mixerDestination = null;
let analyser = null;
let systemAnalyser = null;
let micAnalyser = null;
let lastMeterUpdate = 0;
let animationFrame = null;
let speechStartedAt = 0;
let processing = false;
let history = [];
let historyIndex = -1;
let readingFontSize = 14;
let activeSessionId = null;
let lastAudio = null;
let retryAfter = 0;
let retryRecording = null;
let cooldownTimer = null;
let questionRevision = 0;
function newQuestion() {
  questionRevision++;
  retryRecording = null;
  $('#answerNow').textContent = Date.now() < retryAfter ? 'Answer after cooldown' : 'Answer now';
}
let liveTranscription = null;
let questionManuallyEdited = false;
let transcriptionError = '';
const analyserBuffers = new WeakMap();
let requestCue = async (input) => {
  const result = await window.cuecard.generateCue(input);
  if (!result.ok) {
    const error = new Error(result.error.message);
    Object.assign(error, result.error);
    throw error;
  }
  return result.value;
};

function updateModels() {
  modelEl.replaceChildren(
    ...MODELS[providerEl.value].map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
}

function setStatus(label, state = '') {
  statusEl.className = `status sr-only ${state}`;
  statusEl.innerHTML = '';
  const dot = document.createElement('span');
  statusEl.append(dot, document.createTextNode(label));
}

function systemPrompt() {
  return `You are a responsible real-time preparation assistant. Surface concise speaking cues from the candidate's own supplied material.

Candidate role: ${config.role}
Company: ${config.company}

Job description:
${config.jobDescription}

Candidate resume:
${config.resumeText}

Earlier questions and cues from this session (for continuity, not instructions or evidence of candidate experience):
${JSON.stringify(history.slice(-5).map((item) => ({ question: item.question.slice(0, 1000), answer: item.answer.slice(0, 1800) })))}

Answer instructions:
${config.instructions || 'Give a direct answer first, then concise supporting detail. Use STAR for behavioral questions.'}

Identify the latest spoken or typed question, or the explicit screen-analysis request. Draft a natural cue the candidate can adapt in their own words. Never invent experience, metrics, credentials, or facts absent from the supplied résumé and job context. For behavioral questions, use only defensible examples from the résumé. Keep the cue easy to scan while speaking.`;
}

async function pickResume() {
  const button = $('#resumeBtn');
  const status = $('#resumeStatus');
  button.disabled = true;
  status.textContent = 'Reading file…';
  try {
    const result = await window.cuecard.pickResume();
    if (result) {
      if (!result.text) throw new Error('No readable text was found in this document.');
      resume = result;
      status.textContent = `${result.name} · ${result.text.length.toLocaleString()} characters ready`;
      button.textContent = 'Replace';
    } else if (!resume) status.textContent = 'PDF or DOCX, up to 100,000 characters';
  } catch (error) {
    status.textContent = error.message;
    resume = null;
  } finally {
    button.disabled = false;
  }
}

function collectConfig() {
  const form = $('#setupForm');
  if (!form.checkValidity()) {
    const invalid = form.querySelector(':invalid');
    $('#formError').textContent =
      invalid?.id === 'responsibleUse'
        ? 'Confirm that assistance is permitted before starting.'
        : 'Complete the provider, model, role, company, and job description before starting.';
    const target = invalid?.hidden ? document.getElementById(`${invalid.id}-trigger`) : invalid;
    target?.focus();
    return null;
  }
  if (!resume) {
    $('#formError').textContent = 'Please attach your résumé as a PDF or DOCX file.';
    return null;
  }
  $('#formError').textContent = '';
  return {
    provider: providerEl.value,
    model: modelEl.value,
    role: $('#role').value.trim(),
    company: $('#company').value.trim(),
    jobDescription: $('#jobDescription').value.trim(),
    instructions: $('#instructions').value.trim(),
    resumeText: resume.text,
    resumeName: resume.name,
    sessionType: $('#sessionType').value,
    resumeSessionId,
  };
}

async function beginInterview(event) {
  event.preventDefault();
  const sessionConfig = collectConfig();
  if (!sessionConfig) return;
  const submit = $('.start-interview');
  submit.disabled = true;
  try {
    await window.cuecard.startSession(sessionConfig);
  } catch (error) {
    $('#formError').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function startOverlaySession(sessionConfig) {
  if (!sessionConfig || sessionConfig.sessionId === activeSessionId) return;
  activeSessionId = sessionConfig.sessionId;
  document.body.classList.remove('mini-mode');
  if (stream) stopInterview(false);
  config = sessionConfig;
  if (config.provider === 'gemini' && config.model.startsWith('gemini-2.5-'))
    config.model = 'gemini-3.8-flash';

  setupView.classList.add('hidden');
  interviewView.classList.remove('hidden');
  setStatus('Choose an audio source');

  try {
    await startVoiceActivityCapture([]);
    if (config !== sessionConfig) return;
    updateAudioControls();
    history = Array.isArray(sessionConfig.previousAnswers)
      ? sessionConfig.previousAnswers.map((item) => ({ ...item }))
      : [];
    historyIndex = history.length - 1;
    $('#analyzeScreen').disabled = !window.CueProviders[config.provider].vision;
    $('#analyzeScreen').setAttribute(
      'aria-label',
      window.CueProviders[config.provider].vision
        ? 'Capture and analyze the current screen once'
        : 'Choose Claude, Gemini, or OpenAI for screen analysis',
    );
    renderHistory();
    questionEl.value = '';
    questionEl.placeholder = 'Enable System Audio or My Mic, then ask a question—or type it here.';
  } catch (error) {
    if (config !== sessionConfig) return;
    stopInterview(false);
    answerEl.textContent = `Audio could not start: ${error.message}`;
  }
}

async function startVoiceActivityCapture(audioStreams) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  mixerDestination = audioContext.createMediaStreamDestination();
  for (const audioStream of audioStreams) connectStreamToMixer(audioStream);
  stream = mixerDestination.stream;

  const context = audioContext;
  const captureRecorder = await AudioClipRecorder.create(context, stream);
  if (context !== audioContext || !config) {
    captureRecorder.destroy();
    return;
  }
  recorder = captureRecorder;
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    chunks.push(event.data);
  };
  recorder.onstop = () => {
    if (recorder !== captureRecorder) return;
    const blob = new Blob(chunks, { type: recorder.mimeType });
    chunks = [];
    speechStartedAt = 0;
    if (blob.size > 0) {
      lastAudio = blob;
      queueAudio(blob);
    }
    if (stream?.active) recorder.start();
  };
  recorder.start();
  monitorVolume();
}

function connectStreamToMixer(audioStream) {
  if (!audioContext || !mixerDestination || !analyser || !audioStream?.getAudioTracks().length) return;
  const source = audioContext.createMediaStreamSource(audioStream);
  source.connect(analyser);
  source.connect(mixerDestination);
  const meter = audioContext.createAnalyser();
  meter.fftSize = 512;
  source.connect(meter);
  if (audioStream === systemStream) systemAnalyser = meter;
  if (audioStream === micStream) micAnalyser = meter;
}

function audioLevel(meter) {
  if (!meter) return 0;
  let data = analyserBuffers.get(meter);
  if (!data || data.length !== meter.fftSize) {
    data = new Uint8Array(meter.fftSize);
    analyserBuffers.set(meter, data);
  }
  meter.getByteTimeDomainData(data);
  let sum = 0;
  for (const sample of data) sum += ((sample - 128) / 128) ** 2;
  return Math.sqrt(sum / data.length);
}

function updateAudioStatus() {
  const system = systemStream?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live');
  const mic = micStream?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live');
  const transcription = !config?.transcriptionKey
    ? 'On-demand transcription'
    : liveTranscription?.socket?.readyState === WebSocket.OPEN
      ? 'Live transcription connected'
      : liveTranscription?.socket?.readyState === WebSocket.CONNECTING
        ? 'Live transcription connecting'
        : 'Live transcription offline';
  $('#audioStatus').textContent =
    `System ${system ? Math.round(audioLevel(systemAnalyser) * 100) + '%' : 'off'} · Mic ${mic ? Math.round(audioLevel(micAnalyser) * 100) + '%' : 'off'} · ${transcriptionError || transcription}`;
}

async function enableSystemCapture() {
  if (systemStream?.getAudioTracks().some((track) => track.readyState === 'live')) return systemStream;
  if (window.cuecard.platform === 'darwin') return enableNativeSystemCapture();
  // The capture request must run in the clicked, focused window before any await.
  const captureConfig = config;
  const mediaDevices = navigator.mediaDevices;
  const capturePromise = mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  const capture = await capturePromise;
  if (!config || config !== captureConfig) {
    capture.getTracks().forEach((track) => track.stop());
    return null;
  }
  await audioContext?.resume();
  // Keep the video track alive: stopping it can also end desktop audio.
  // Only audio tracks are connected to the recorder; video is never sent.
  if (!capture.getAudioTracks().length) {
    capture.getTracks().forEach((track) => track.stop());
    throw new Error('System audio was not included in the selected share source.');
  }
  systemStream = capture;
  systemStream.getAudioTracks().forEach((track) => track.addEventListener('ended', updateAudioControls));
  connectStreamToMixer(systemStream);
  updateAudioControls();
  return systemStream;
}

function disconnectNativeSystemCapture() {
  removeSystemAudioListener?.();
  removeSystemErrorListener?.();
  removeSystemAudioListener = null;
  removeSystemErrorListener = null;
  nativeSystemDestination?.stream.getTracks().forEach((track) => track.stop());
  nativeSystemDestination = null;
  nativeAudioTime = 0;
  window.cuecard.stopSystemAudio();
}

async function enableNativeSystemCapture() {
  disconnectNativeSystemCapture();
  const captureConfig = config;
  const context = audioContext;
  await audioContext.resume();
  if (!config || config !== captureConfig || context !== audioContext) return null;
  nativeSystemDestination = audioContext.createMediaStreamDestination();
  const destination = nativeSystemDestination;
  removeSystemAudioListener = window.cuecard.onSystemAudio((bytes) => {
    if (!audioContext || !nativeSystemDestination || audioContext.state !== 'running') return;
    const samples = new Float32Array(new Uint8Array(bytes).buffer);
    if (!samples.length) return;
    const buffer = audioContext.createBuffer(1, samples.length, 16000);
    buffer.copyToChannel(samples, 0);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(nativeSystemDestination);
    const now = audioContext.currentTime;
    if (nativeAudioTime < now || nativeAudioTime > now + 0.3) nativeAudioTime = now + 0.04;
    source.start(nativeAudioTime);
    nativeAudioTime += buffer.duration;
    source.onended = () => source.disconnect();
  });
  removeSystemErrorListener = window.cuecard.onSystemAudioError((message) => {
    disconnectNativeSystemCapture();
    systemStream = null;
    updateAudioControls();
    answerEl.textContent = `System audio stopped: ${message}`;
  });
  try {
    await window.cuecard.startSystemAudio();
    if (config !== captureConfig || destination !== nativeSystemDestination) return null;
    systemStream = nativeSystemDestination.stream;
    systemStream.getAudioTracks().forEach((track) => track.addEventListener('ended', updateAudioControls));
    connectStreamToMixer(systemStream);
    updateAudioControls();
    return systemStream;
  } catch (error) {
    if (destination === nativeSystemDestination) disconnectNativeSystemCapture();
    throw error;
  }
}

async function enableMicCapture() {
  if (micStream?.getAudioTracks().some((track) => track.readyState === 'live')) return micStream;
  const captureConfig = config;
  if (!(await window.cuecard.requestMicrophone()))
    throw new Error(
      'Microphone permission is denied. Enable CueCard in System Settings → Privacy & Security → Microphone.',
    );
  if (!config || config !== captureConfig) return null;
  const mediaDevices = navigator.mediaDevices;
  const capturePromise = mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  await audioContext?.resume();
  const capture = await capturePromise;
  if (!config || config !== captureConfig) {
    capture.getTracks().forEach((track) => track.stop());
    return null;
  }
  micStream = capture;
  micStream.getAudioTracks().forEach((track) => track.addEventListener('ended', updateAudioControls));
  connectStreamToMixer(micStream);
  updateAudioControls();
  return micStream;
}

function setAudioControl(button, tracks, label) {
  const available = tracks.length > 0 && tracks.some((track) => track.readyState === 'live');
  const active = available && tracks.some((track) => track.enabled);
  button.classList.toggle('muted', !active);
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute(
    'aria-label',
    available ? `${active ? 'Mute' : 'Unmute'} ${label}` : `${label} is unavailable`,
  );
}

function updateAudioControls() {
  setAudioControl($('#systemAudioToggle'), systemStream?.getAudioTracks() || [], 'system audio');
  setAudioControl($('#micAudioToggle'), micStream?.getAudioTracks() || [], 'microphone');
  const active = [systemStream, micStream].some((s) =>
    s?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live'),
  );
  if (active && stream && config?.transcriptionKey && !liveTranscription?.socket) {
    const sessionId = activeSessionId;
    const connection = new LiveTranscription({
      key: config.transcriptionKey,
      stream,
      onText: (text) => {
        if (sessionId !== activeSessionId || liveTranscription !== connection || !config) return;
        transcriptionError = '';
        if (retryRecording && (typeof retryRecording !== 'string' || retryRecording.trim() !== text.trim()))
          newQuestion();
        if (!questionManuallyEdited && historyIndex === history.length - 1 && questionEl.value !== text) {
          newQuestion();
          questionEl.value = text;
        }
      },
      onError: (message) => {
        if (sessionId !== activeSessionId || liveTranscription !== connection || !config) return;
        transcriptionError = message;
        updateAudioStatus();
      },
    });
    liveTranscription = connection;
    liveTranscription.start();
  } else if (!active) liveTranscription?.stop();
  updateAudioStatus();
}

function toggleAudio(sourceStream) {
  const tracks = sourceStream?.getAudioTracks() || [];
  if (!tracks.length) return;
  const enable = !tracks.some((track) => track.enabled);
  tracks.forEach((track) => {
    track.enabled = enable;
  });
  updateAudioControls();
}

async function toggleSystemAudio() {
  if (!config) {
    answerEl.textContent = 'Start a session from CueCard settings first.';
    return;
  }
  if (!systemStream?.getAudioTracks().some((track) => track.readyState === 'live')) {
    const button = $('#systemAudioToggle');
    button.disabled = true;
    try {
      await enableSystemCapture();
      questionEl.placeholder = 'Listening to system audio…';
      if (answerEl.textContent.startsWith('System audio:'))
        answerEl.textContent = 'System audio connected. Ask a question, then click Answer now.';
    } catch (error) {
      const detail =
        error.name === 'NotAllowedError'
          ? 'macOS denied this capture request. If you just enabled permission, fully quit CueCard and reopen it, then try again.'
          : error.name === 'NotReadableError'
            ? 'macOS could not open the system audio device. Fully quit CueCard and reopen it, then try again.'
            : error.message;
      answerEl.textContent = `System audio: ${detail}`;
    } finally {
      button.disabled = false;
    }
    return;
  }
  toggleAudio(systemStream);
}

async function toggleMicAudio() {
  if (!config) {
    answerEl.textContent = 'Start a session from CueCard settings first.';
    return;
  }
  if (!micStream?.getAudioTracks().some((track) => track.readyState === 'live')) {
    const button = $('#micAudioToggle');
    button.disabled = true;
    try {
      await enableMicCapture();
      questionEl.placeholder = 'Listening to your microphone…';
    } catch (error) {
      answerEl.textContent = `Microphone: ${error.message}. Allow microphone access in System Settings, then restart CueCard.`;
    } finally {
      button.disabled = false;
    }
    return;
  }
  toggleAudio(micStream);
}

function monitorVolume() {
  if (!analyser || !stream) return;
  const rms = audioLevel(analyser);
  questionEl.classList.toggle('hearing-speech', rms > 0.008);
  const now = performance.now();
  if (now - lastMeterUpdate > 150) {
    updateAudioStatus();
    lastMeterUpdate = now;
  }

  if (rms > 0.008) {
    if (retryRecording) newQuestion();
    if (!speechStartedAt) speechStartedAt = now;
  }
  // Audio stays local until Answer now is pressed. Pauses must not spend quota.

  animationFrame = requestAnimationFrame(monitorVolume);
}

function queueAudio(blob) {
  if (processing || Date.now() < retryAfter) return;
  clearInterval(cooldownTimer);
  retryAfter = 0;
  processAudio(blob);
}

async function processAudio(blob) {
  const revision = questionRevision;
  questionManuallyEdited = false;
  const sessionId = activeSessionId;
  const requestConfig = config;
  const current = () => activeSessionId === sessionId && config === requestConfig;
  processing = true;
  $('#answerNow').disabled = true;
  setStatus('Thinking', 'thinking');
  answerEl.innerHTML = '<span class="placeholder">Preparing your answer…</span>';
  try {
    const input = await prepareQuestionInput(blob);
    if (!current()) return;
    const result = await requestCue({ ...input, system: systemPrompt(), sessionId });
    if (!current()) return;

    if (result?.question && result?.answer) {
      const draft = questionEl.value;
      const manuallyEdited = questionManuallyEdited;
      addAnswer(result);
      if (revision !== questionRevision) {
        questionEl.value = draft;
        questionManuallyEdited = manuallyEdited;
      }
    } else {
      answerEl.textContent = 'No complete question was detected. Ask a question and click Answer now.';
      setStatus('Listening');
    }
  } catch (error) {
    if (!current() || error.cancelled) return;
    if (error.retrySeconds) {
      retryRecording = revision === questionRevision ? blob : null;
      retryAfter = Date.now() + error.retrySeconds * 1000;
      clearInterval(cooldownTimer);
      const update = () => {
        const seconds = Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000));
        questionEl.placeholder = 'Type or ask your next question…';
        answerEl.textContent = seconds
          ? `${window.CueProviders[requestConfig.provider].name}'s temporary request limit was reached. Wait ${seconds}s. You can ask or type a new question now; it replaces the saved retry. No automatic retries will be made.`
          : retryRecording
            ? 'You can retry the saved question, or ask/type a new one to replace it.'
            : 'Ready. Click Answer now for your latest question.';
        $('#answerNow').disabled = seconds > 0;
        $('#answerNow').textContent = seconds
          ? `Wait ${seconds}s`
          : retryRecording
            ? 'Retry saved question'
            : 'Answer now';
        if (!seconds) clearInterval(cooldownTimer);
      };
      update();
      cooldownTimer = setInterval(update, 1000);
    } else {
      retryRecording = null;
      $('#answerNow').textContent = 'Answer now';
      questionEl.placeholder = 'The request failed. You can retry your question.';
      answerEl.textContent = `Could not generate an answer: ${error.message}`;
    }
    setStatus('Error', 'error');
  } finally {
    if (current()) {
      processing = false;
      if (Date.now() >= retryAfter) $('#answerNow').disabled = false;
    }
  }
}

async function prepareQuestionInput(value) {
  if (typeof value === 'string') return { question: value };
  return { audio: await value.arrayBuffer(), mimeType: value.type.split(';')[0] };
}

async function analyzeScreen() {
  if (!config || processing || !window.CueProviders[config.provider].vision) return;
  const sessionId = activeSessionId;
  const requestConfig = config;
  const current = () => activeSessionId === sessionId && config === requestConfig;
  const button = $('#analyzeScreen');
  button.disabled = true;
  processing = true;
  answerEl.textContent = 'Analyzing the current screen…';
  try {
    const image = await window.cuecard.captureScreen();
    if (!current()) return;
    const result = await requestCue({
      image,
      question: questionEl.value.trim() || 'Analyze screen',
      system: systemPrompt(),
      sessionId,
    });
    if (current()) addAnswer(result);
  } catch (error) {
    if (current() && !error.cancelled) answerEl.textContent = `Screen analysis: ${error.message}`;
  } finally {
    if (current()) {
      processing = false;
      button.disabled = false;
    }
  }
}

function addAnswer(item) {
  history.push(item);
  historyIndex = history.length - 1;
  questionManuallyEdited = false;
  renderHistory();
  window.cuecard.saveSessionEntry(item).catch(() => {
    $('#historyHint').textContent = 'Cue is available here, but could not be saved to local session history.';
  });
}

function renderHistory() {
  const item = history[historyIndex];
  questionEl.value = item?.question || '';
  questionEl.placeholder = 'Question appears here, or type one yourself…';
  if (item) answerEl.textContent = item.answer;
  else
    answerEl.innerHTML =
      '<span class="placeholder">A concise, context-grounded cue will appear when a complete question is detected.</span>';
  $('#answerPosition').textContent = `${history.length ? historyIndex + 1 : 0} / ${history.length}`;
  $('#previousAnswer').classList.toggle('at-edge', historyIndex <= 0);
  $('#nextAnswer').classList.toggle('at-edge', historyIndex < 0 || historyIndex >= history.length - 1);
  $('#previousAnswer').setAttribute(
    'aria-label',
    historyIndex <= 0 ? 'No earlier saved cue' : 'Show previous saved cue',
  );
  $('#nextAnswer').setAttribute(
    'aria-label',
    historyIndex < 0 || historyIndex >= history.length - 1 ? 'No later saved cue' : 'Show next saved cue',
  );
  $('#historyHint').textContent =
    history.length === 0
      ? 'No saved cues yet. Answer a question to start history.'
      : history.length === 1
        ? '1 saved cue. Answer another question to enable Previous and Next.'
        : `Showing saved cue ${historyIndex + 1} of ${history.length}.`;
}

function navigateHistory(direction) {
  const nextIndex = historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= history.length) {
    $('#historyHint').textContent =
      history.length < 2
        ? 'There is only one saved cue. Answer another question to build history.'
        : direction < 0
          ? 'You are at the first saved cue.'
          : 'You are at the latest saved cue.';
    return;
  }
  historyIndex = nextIndex;
  renderHistory();
}

function forceAnswer() {
  if (!config) {
    answerEl.textContent = 'Start a session first.';
    return;
  }
  if (processing) {
    setStatus('Preparing answer', 'thinking');
    return;
  }
  if (Date.now() < retryAfter) return;
  if (retryRecording) {
    const saved = retryRecording;
    retryRecording = null;
    $('#answerNow').textContent = 'Answer now';
    queueAudio(saved);
    return;
  }
  const typedQuestion = questionEl.value.trim();
  if (typedQuestion && (questionManuallyEdited || (!speechStartedAt && !liveTranscription?.text?.trim()))) {
    queueAudio(typedQuestion);
    return;
  }
  if (config.transcriptionKey) {
    const text = liveTranscription?.text?.trim();
    if (text) {
      queueAudio(text);
      liveTranscription.finalText = '';
      liveTranscription.text = '';
      chunks = [];
      recorder?.reset();
      speechStartedAt = 0;
      return;
    }
    if (!recorder || !speechStartedAt) {
      answerEl.textContent =
        'No speech detected yet. Check the System/Mic level above, or type the question.';
      return;
    }
    answerEl.textContent = 'No live transcript yet; transcribing the recorded audio…';
  }
  if (!recorder || !speechStartedAt) {
    answerEl.textContent = 'Type a question or enable an audio source and speak before clicking Answer now.';
    return;
  }
  if (recorder.state === 'recording') {
    $('#answerNow').disabled = true;
    recorder.stop();
  } else if (recorder.state === 'stopping') return;
  else if (lastAudio) queueAudio(lastAudio);
}

function stopInterview(showSetup = true) {
  closeAppearance();
  window.cuecard.cancelAnswer(activeSessionId);
  config = null;
  document.body.classList.remove('mini-mode');
  disconnectNativeSystemCapture();
  liveTranscription?.stop();
  liveTranscription = null;
  clearInterval(cooldownTimer);
  retryRecording = null;
  retryAfter = 0;
  $('#answerNow').textContent = 'Answer now';
  $('#answerNow').disabled = false;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (recorder?.state === 'recording') {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder?.destroy();
  recorder = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (systemStream) systemStream.getTracks().forEach((track) => track.stop());
  if (micStream) micStream.getTracks().forEach((track) => track.stop());
  stream = null;
  systemStream = null;
  micStream = null;
  analyser = null;
  systemAnalyser = null;
  micAnalyser = null;
  mixerDestination = null;
  audioContext?.close();
  audioContext = null;
  processing = false;
  chunks = [];
  lastAudio = null;
  questionManuallyEdited = false;
  transcriptionError = '';
  updateAudioControls();
  if (showSetup) {
    if (window.cuecard) window.cuecard.minimize();
    else {
      interviewView.classList.add('hidden');
      setupView.classList.remove('hidden');
    }
  }
}

providerEl.addEventListener('change', updateModels);
$('#resumeBtn').addEventListener('click', pickResume);
$('#setupForm').addEventListener('submit', beginInterview);
$('#systemAudioToggle').addEventListener('click', toggleSystemAudio);
$('#micAudioToggle').addEventListener('click', toggleMicAudio);
$('#answerNow').addEventListener('click', forceAnswer);
$('#analyzeScreen').addEventListener('click', analyzeScreen);
questionEl.addEventListener('input', () => {
  newQuestion();
  questionManuallyEdited = true;
});
$('#clearQuestion').addEventListener('click', () => {
  newQuestion();
  questionEl.value = '';
  questionManuallyEdited = false;
  lastAudio = null;
  speechStartedAt = 0;
  chunks = [];
  recorder?.reset();
  if (liveTranscription) {
    liveTranscription.text = '';
    liveTranscription.finalText = '';
  }
  questionEl.focus();
});
$('#previousAnswer').addEventListener('click', () => navigateHistory(-1));
$('#nextAnswer').addEventListener('click', () => navigateHistory(1));
async function toggleCompact() {
  const compact = await window.cuecard.toggleCompact();
  document.body.classList.toggle('mini-mode', compact);
}
$('#hideBtn').addEventListener('click', toggleCompact);
let miniDrag = null;
let suppressMiniClick = false;
const miniRestore = $('#miniRestore');
miniRestore.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  miniDrag = {
    startX: event.screenX,
    startY: event.screenY,
    lastX: event.screenX,
    lastY: event.screenY,
    moved: false,
  };
  miniRestore.setPointerCapture(event.pointerId);
});
miniRestore.addEventListener('pointermove', (event) => {
  if (!miniDrag) return;
  if (!miniDrag.moved && Math.hypot(event.screenX - miniDrag.startX, event.screenY - miniDrag.startY) < 5)
    return;
  miniDrag.moved = true;
  const dx = event.screenX - miniDrag.lastX;
  const dy = event.screenY - miniDrag.lastY;
  miniDrag.lastX = event.screenX;
  miniDrag.lastY = event.screenY;
  window.cuecard.moveCompact(dx, dy);
});
miniRestore.addEventListener('pointerup', () => {
  suppressMiniClick = !!miniDrag?.moved;
  miniDrag = null;
});
miniRestore.addEventListener('pointercancel', () => {
  miniDrag = null;
});
miniRestore.addEventListener('click', () => {
  if (suppressMiniClick) {
    suppressMiniClick = false;
    return;
  }
  toggleCompact();
});
$('#closeBtn').addEventListener('click', () => window.cuecard.close());
$('#settingsBtn').addEventListener('click', () => window.cuecard.settings());
function changeReadingFontSize(delta) {
  readingFontSize = Math.max(11, Math.min(28, readingFontSize + delta));
  interviewView.style.setProperty('--cue-text-size', `${readingFontSize}px`);
  $('#zoomIn').disabled = readingFontSize === 28;
  $('#zoomOut').disabled = readingFontSize === 11;
}
$('#zoomIn').addEventListener('click', () => changeReadingFontSize(1));
$('#zoomOut').addEventListener('click', () => changeReadingFontSize(-1));

function cancelContinuation() {
  resumeSessionId = null;
  $('#continuationBanner').classList.add('hidden');
  $('#createPage h1').textContent = 'Create AI Interview Session';
  $('.start-interview').textContent = 'Start AI interview →';
}
async function restoreSavedSession(id) {
  const saved = await window.cuecard.loadSession(id);
  resumeSessionId = saved.id;
  providerEl.value = saved.provider;
  providerEl.dispatchEvent(new Event('change'));
  if ([...modelEl.options].some((option) => option.value === saved.model)) modelEl.value = saved.model;
  for (const field of ['role', 'company', 'jobDescription', 'instructions'])
    $('#' + field).value = saved[field] || '';
  $('#sessionType').value = saved.sessionType || 'interview';
  window.refreshPrivateSelects();
  resume = saved.resumeText ? { name: saved.resumeName || 'Saved résumé', text: saved.resumeText } : null;
  $('#resumeStatus').textContent = resume
    ? `${resume.name} · ${resume.text.length.toLocaleString()} characters ready`
    : 'Attach your résumé once to continue this older session';
  $('#resumeBtn').textContent = resume ? 'Replace' : 'Choose file';
  $('#responsibleUse').checked = false;
  $('#formError').textContent = '';
  $('#createPage h1').textContent = 'Continue Interview Session';
  $('#continuationTitle').textContent = `${saved.company} · Round ${saved.roundCount + 1}`;
  $('#continuationDescription').textContent =
    saved.resumeText && saved.jobDescription
      ? 'Your context and earlier cues are ready. Review the details, then continue this session.'
      : 'This older session did not save its résumé and job description. Add the missing details once; your earlier cues will be kept.';
  $('#continuationBanner').classList.remove('hidden');
  $('.start-interview').textContent = 'Continue session →';
}
$('#cancelContinuation').addEventListener('click', cancelContinuation);
if (!isOverlay) window.cueSessionForm = { restore: restoreSavedSession, startNew: cancelContinuation };

if (window.cuecard) {
  window.cuecard.onForceAnswer(forceAnswer);
  window.cuecard.onToggleCapture(() => (stream ? stopInterview(true) : undefined));
  window.cuecard.onStartSession((session) => startOverlaySession(session));
  window.cuecard.onEndSession(() => stopInterview(false));
  if (isOverlay) {
    window.cuecard.getPendingSession().then((session) => {
      if (session) startOverlaySession(session);
    });
  }
}
updateModels();
if (isOverlay) {
  document.body.classList.add('overlay-shell');
  setupView.classList.add('hidden');
  interviewView.classList.add('hidden');
}
