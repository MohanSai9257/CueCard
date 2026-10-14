const $ = selector => document.querySelector(selector);

const MODELS = {
  gemini: [
    ["gemini-3.8-flash", "Gemini 3.8 Flash"],
  ],
  groq: [
    ["llama-3.3-70b-versatile", "Llama 3.3 70B"],
    ["llama-3.1-8b-instant", "Llama 3.1 8B"],
  ],
  openai: [
    ["gpt-4.1-mini", "GPT-4.1 Mini"],
    ["gpt-4.1", "GPT-4.1"],
  ],
};

const API_KEY_LINKS = {
  gemini: { label: "Get a Gemini API key ↗", url: "https://aistudio.google.com/apikey" },
  groq: { label: "Get a Groq API key ↗", url: "https://console.groq.com/keys" },
  openai: { label: "Get an OpenAI API key ↗", url: "https://platform.openai.com/api-keys" },
};

const setupView = $("#setupView");
const interviewView = $("#interviewView");
const providerEl = $("#provider");
const modelEl = $("#model");
const answerEl = $("#answer");
const questionEl = $("#question");
const statusEl = $("#status");
const isOverlay = new URLSearchParams(location.search).has("overlay");

let resume = null;
let config = null;
let stream = null;
let systemStream = null;
let micStream = null;
let recorder = null;
let chunks = [];
let audioContext = null;
let mixerDestination = null;
let analyser = null;
let animationFrame = null;
let speechStartedAt = 0;
let lastSpeechAt = 0;
let processing = false;
let pendingBlob = null;
let history = [];
let historyIndex = -1;
let zoom = 1;
let currentQuestion = "";
let awaitingNextQuestion = false;
let activeSessionId = null;
let lastAudio = null;
let retryAfter = 0;
let retryRecording = null;
let cooldownTimer = null;
let liveTranscription = null;

function updateModels() {
  modelEl.replaceChildren(...MODELS[providerEl.value].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  const keyLink = API_KEY_LINKS[providerEl.value];
  $("#apiKeyLink").textContent = keyLink.label;
  $("#apiKeyLink").href = keyLink.url;
}

function setStatus(label, state = "") {
  statusEl.className = `status sr-only ${state}`;
  statusEl.innerHTML = "";
  const dot = document.createElement("span");
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

Answer instructions:
${config.instructions || "Give a direct answer first, then concise supporting detail. Use STAR for behavioral questions."}

Identify the most recent complete question in the audio. Draft a natural cue the candidate can adapt in their own words. Never invent experience, metrics, credentials, or facts absent from the supplied résumé and job context. For behavioral questions, use only defensible examples from the résumé. Keep the cue easy to scan while speaking.`;
}

async function pickResume() {
  const button = $("#resumeBtn");
  const status = $("#resumeStatus");
  button.disabled = true;
  status.textContent = "Reading file…";
  try {
    if (!window.cuecard) {
      $("#resumeFile").click();
      return;
    }
    const result = await window.cuecard.pickResume();
    if (result) {
      if (!result.text) throw new Error("No readable text was found in this document.");
      resume = result;
      status.textContent = `${result.name} · ${result.text.length.toLocaleString()} characters ready`;
      button.textContent = "Replace";
    } else if (!resume) status.textContent = "PDF or DOCX, up to 100,000 characters";
  } catch (error) {
    status.textContent = error.message;
    resume = null;
  } finally {
    button.disabled = false;
  }
}

async function readBrowserResume(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const button = $("#resumeBtn");
  const status = $("#resumeStatus");
  button.disabled = true;
  status.textContent = "Reading file…";
  try {
    const response = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
      body: await file.arrayBuffer(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not read the résumé.");
    resume = result;
    status.textContent = `${result.name} · ${result.text.length.toLocaleString()} characters ready`;
    button.textContent = "Replace";
  } catch (error) {
    resume = null;
    status.textContent = error instanceof TypeError && /fetch/i.test(error.message)
      ? "CueCard service was restarted. Open or reload http://127.0.0.1:32145 and try again."
      : error.message;
  } finally {
    button.disabled = false;
    event.target.value = "";
  }
}

function collectConfig() {
  const form = $("#setupForm");
  if (!form.reportValidity()) return null;
  if (!resume) {
    $("#formError").textContent = "Please attach your résumé as a PDF or DOCX file.";
    return null;
  }
  $("#formError").textContent = "";
  return {
    provider: providerEl.value,
    model: modelEl.value,
    apiKey: $("#apiKey").value.trim(),
    role: $("#role").value.trim(),
    company: $("#company").value.trim(),
    jobDescription: $("#jobDescription").value.trim(),
    instructions: $("#instructions").value.trim(),
    resumeText: resume.text,
    transcriptionKey: $("#transcriptionKey").value.trim(),
  };
}

async function beginInterview(event) {
  event.preventDefault();
  const sessionConfig = collectConfig();
  if (!sessionConfig) return;

  if (!window.cuecard) {
    const submit = $(".start-interview");
    submit.disabled = true;
    submit.textContent = "Opening floating assistant…";
    try {
      const response = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionConfig),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start the assistant.");
      submit.disabled = false;
      submit.innerHTML = "Restart AI interview <span>→</span>";
      $("#formError").textContent = "The floating CueCard window is now active. This Chrome tab remains your session setup screen.";
    } catch (error) {
      $("#formError").textContent = error.message;
      submit.disabled = false;
      submit.innerHTML = "Start AI interview <span>→</span>";
    }
    return;
  }

  await startOverlaySession(sessionConfig);
}

async function startOverlaySession(sessionConfig) {
  if (!sessionConfig || sessionConfig.sessionId === activeSessionId) return;
  activeSessionId = sessionConfig.sessionId;
  if (stream) stopInterview(false);
  config = sessionConfig;
  if (config.provider === "gemini" && config.model.startsWith("gemini-2.5-")) config.model = "gemini-3.8-flash";

  setupView.classList.add("hidden");
  interviewView.classList.remove("hidden");
  setStatus("Choose an audio source");

  try {
    await startVoiceActivityCapture([]);
    updateAudioControls();
    history = [];
    historyIndex = -1;
    currentQuestion = "";
    awaitingNextQuestion = false;
    renderHistory();
    questionEl.textContent = "Enable System Audio or My Mic, then ask a question.";
  } catch (error) {
    stopInterview(false);
    answerEl.textContent = `Audio could not start: ${error.message}`;
  }
}

function supportedMimeType() {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type)) || "";
}

async function startVoiceActivityCapture(audioStreams) {
  audioContext = new AudioContext();
  await audioContext.resume();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  mixerDestination = audioContext.createMediaStreamDestination();
  for (const audioStream of audioStreams) connectStreamToMixer(audioStream);
  stream = mixerDestination.stream;

  const options = { audioBitsPerSecond: 48000 };
  const mimeType = supportedMimeType();
  if (mimeType) options.mimeType = mimeType;
  recorder = new MediaRecorder(stream, options);
  recorder.ondataavailable = event => { if (!config?.transcriptionKey && event.data.size) chunks.push(event.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
    chunks = [];
    speechStartedAt = 0;
    lastSpeechAt = 0;
    if (blob.size > 0) { lastAudio = blob; queueAudio(blob); }
    if (stream?.active) recorder.start(250);
  };
  recorder.start(250);
  monitorVolume();
}

function connectStreamToMixer(audioStream) {
  if (!audioContext || !mixerDestination || !analyser || !audioStream?.getAudioTracks().length) return;
  const source = audioContext.createMediaStreamSource(audioStream);
  source.connect(analyser);
  source.connect(mixerDestination);
}

async function enableSystemCapture() {
  if (systemStream?.getAudioTracks().some(track => track.readyState === "live")) return systemStream;
  const capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  // Keep the video track alive: stopping it can also end desktop audio.
  // Only audio tracks are connected to the recorder; video is never sent.
  if (!capture.getAudioTracks().length) {
    capture.getTracks().forEach(track => track.stop());
    throw new Error("System audio was not included in the selected share source.");
  }
  systemStream = capture;
  systemStream.getAudioTracks().forEach(track => track.addEventListener("ended", updateAudioControls));
  connectStreamToMixer(systemStream);
  updateAudioControls();
  return systemStream;
}

async function enableMicCapture() {
  if (micStream?.getAudioTracks().some(track => track.readyState === "live")) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  micStream.getAudioTracks().forEach(track => track.addEventListener("ended", updateAudioControls));
  connectStreamToMixer(micStream);
  updateAudioControls();
  return micStream;
}

function setAudioControl(button, tracks, label) {
  const available = tracks.length > 0 && tracks.some(track => track.readyState === "live");
  const active = available && tracks.some(track => track.enabled);
  button.classList.toggle("muted", !active);
  button.setAttribute("aria-pressed", String(active));
  button.title = available ? `${active ? "Mute" : "Unmute"} ${label}` : `${label} is unavailable`;
}

function updateAudioControls() {
  setAudioControl($("#systemAudioToggle"), systemStream?.getAudioTracks() || [], "system audio");
  setAudioControl($("#micAudioToggle"), micStream?.getAudioTracks() || [], "microphone");
  const active = [systemStream, micStream].some(s => s?.getAudioTracks().some(t => t.enabled && t.readyState === "live"));
  if (active && stream && config?.transcriptionKey && !liveTranscription?.socket) {
    liveTranscription = new LiveTranscription({
      key: config.transcriptionKey, stream,
      onText: text => { questionEl.textContent = text; },
      onError: message => { answerEl.textContent = message; },
    });
    liveTranscription.start();
  } else if (!active) liveTranscription?.stop();
}

function toggleAudio(sourceStream) {
  const tracks = sourceStream?.getAudioTracks() || [];
  if (!tracks.length) return;
  const enable = !tracks.some(track => track.enabled);
  tracks.forEach(track => { track.enabled = enable; });
  updateAudioControls();
}

async function toggleSystemAudio() {
  if (!config) { answerEl.textContent = "Start a session from the Chrome setup page first."; return; }
  await audioContext?.resume();
  if (!systemStream?.getAudioTracks().some(track => track.readyState === "live")) {
    const button = $("#systemAudioToggle");
    button.disabled = true;
    try { await enableSystemCapture(); questionEl.textContent = "Listening to system audio…"; } catch (error) { answerEl.textContent = `System audio: ${error.message}`; }
    finally { button.disabled = false; }
    return;
  }
  toggleAudio(systemStream);
}

async function toggleMicAudio() {
  if (!config) { answerEl.textContent = "Start a session from the Chrome setup page first."; return; }
  await audioContext?.resume();
  if (!micStream?.getAudioTracks().some(track => track.readyState === "live")) {
    const button = $("#micAudioToggle");
    button.disabled = true;
    try { await enableMicCapture(); questionEl.textContent = "Listening to your microphone…"; } catch (error) { answerEl.textContent = `Microphone: ${error.message}. Allow microphone access in System Settings, then restart CueCard.`; }
    finally { button.disabled = false; }
    return;
  }
  toggleAudio(micStream);
}

function monitorVolume() {
  if (!analyser || !stream) return;
  const samples = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / samples.length);
  questionEl.classList.toggle("hearing-speech", rms > 0.008);
  const now = performance.now();

  if (rms > 0.008) {
    if (!speechStartedAt) speechStartedAt = now;
    lastSpeechAt = now;
  }
  // Audio stays local until Answer now is pressed. Pauses must not spend quota.

  animationFrame = requestAnimationFrame(monitorVolume);
}

function queueAudio(blob) {
  if (processing || Date.now() < retryAfter) return;
  processAudio(blob);
}

async function processAudio(blob) {
  processing = true;
  $("#answerNow").disabled = true;
  setStatus("Thinking", "thinking");
  answerEl.innerHTML = '<span class="placeholder">Preparing your answer…</span>';
  try {
    const result = config.provider === "gemini" ? await askGemini(blob) : await askOpenAICompatible(blob);

    if (result?.question && result?.answer) addAnswer(result);
    else { answerEl.textContent = "No complete question was detected. Ask a question and click Answer now."; setStatus("Listening"); }
  } catch (error) {
    if (error.retrySeconds) {
      retryRecording = blob;
      retryAfter = Date.now() + error.retrySeconds * 1000;
      clearInterval(cooldownTimer);
      const update = () => {
        const seconds = Math.max(0, Math.ceil((retryAfter - Date.now()) / 1000));
        questionEl.textContent = "Recording saved — waiting for Gemini quota.";
        answerEl.textContent = seconds ? `Gemini's request limit was reached. Retry in ${seconds}s. Your recording is saved; no automatic retries will be made.` : "You can retry now. Click Retry saved question; you do not need to repeat it.";
        $("#answerNow").disabled = seconds > 0;
        $("#answerNow").textContent = seconds ? `Retry in ${seconds}s` : "Retry saved question";
        if (!seconds) clearInterval(cooldownTimer);
      };
      update();
      cooldownTimer = setInterval(update, 1000);
    } else {
      questionEl.textContent = "Audio processing failed. Your recording was captured.";
      answerEl.textContent = `Could not generate an answer: ${error.message}`;
    }
    setStatus("Error", "error");
  } finally {
    processing = false;
    pendingBlob = null;
    if (Date.now() >= retryAfter) $("#answerNow").disabled = false;
  }
}

async function askGemini(blob) {
  const transcript = typeof blob === "string" ? blob : null;
  const audio = transcript ? null : await blobToBase64(blob);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  questionEl.textContent = transcript || "Processing your recorded question…";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt() }] },
      contents: [{ role: "user", parts: [
        { text: 'Listen to the recorded speech. Return JSON with "question" containing the spoken question or request and "answer" containing an answer based on the supplied résumé, job description, and instructions. Do not invent speech. If no speech is audible, return empty strings.' },
        ...(transcript ? [{ text: `Transcribed question: ${transcript}` }] : [{ inline_data: { mime_type: blob.type.split(";")[0], data: audio } }]),
      ] }],
      generationConfig: { temperature: 0.25, maxOutputTokens: 4096, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error?.message || `Gemini request failed (${response.status})`);
    if (response.status === 429) {
      const retry = body.error?.details?.find(item => item.retryDelay)?.retryDelay;
      error.retrySeconds = Math.max(1, Math.ceil(Number.parseFloat(retry || response.headers?.get("retry-after")) || 60));
    }
    throw error;
  }
  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
  return parseModelJson(text);
}

async function askOpenAICompatible(blob) {
  const isGroq = config.provider === "groq";
  const baseUrl = isGroq ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
  let transcript = typeof blob === "string" ? blob : null;
  if (!transcript) {
  const form = new FormData();
  form.append("file", blob, blob.type.includes("mp4") ? "interview.m4a" : "interview.webm");
  form.append("model", isGroq ? "whisper-large-v3-turbo" : "whisper-1");
  form.append("response_format", "json");
  const transcriptionResponse = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  if (!transcriptionResponse.ok) throw new Error(`Transcription ${transcriptionResponse.status}: ${await transcriptionResponse.text()}`);
  transcript = (await transcriptionResponse.json()).text?.trim();
  }
  if (!transcript) return null;
  questionEl.textContent = transcript;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${systemPrompt()}\nReturn only JSON with question and answer string fields.` },
        { role: "user", content: `Latest call transcript:\n${transcript}\n\nIf it contains a complete question, identify it and provide a concise contextual speaking cue. Otherwise return empty strings.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Answer API ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return parseModelJson(json.choices?.[0]?.message?.content);
}

function parseModelJson(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    return { question: String(parsed.question || "").trim(), answer: String(parsed.answer || "").trim() };
  } catch {
    throw new Error("The AI returned an unreadable response. Please try Answer now.");
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function addAnswer(item) {
  currentQuestion = item.question;
  const previous = history[history.length - 1];
  if (previous?.question.toLowerCase() === item.question.toLowerCase()) history[history.length - 1] = item;
  else history.push(item);
  historyIndex = history.length - 1;
  renderHistory();
}

function renderHistory() {
  const item = history[historyIndex];
  questionEl.textContent = item?.question || "Listening for the first question…";
  if (item) answerEl.textContent = item.answer;
  else answerEl.innerHTML = '<span class="placeholder">A concise, context-grounded cue will appear when a complete question is detected.</span>';
  $("#answerPosition").textContent = `${history.length ? historyIndex + 1 : 0} / ${history.length}`;
  $("#previousAnswer").disabled = historyIndex <= 0;
  $("#nextAnswer").disabled = historyIndex < 0 || historyIndex >= history.length - 1;
}

function forceAnswer() {
  if (!config || !recorder) { answerEl.textContent = "Start a session and enable an audio source first."; return; }
  if (processing) { setStatus("Preparing answer", "thinking"); return; }
  if (Date.now() < retryAfter) return;
  if (retryRecording) {
    const saved = retryRecording;
    retryRecording = null;
    $("#answerNow").textContent = "Answer now";
    queueAudio(saved);
    return;
  }
  if (config.transcriptionKey) {
    const text = liveTranscription?.text?.trim();
    if (!text) { answerEl.textContent = "Waiting for live speech text. Check the audio source and Deepgram connection."; return; }
    queueAudio(text);
    liveTranscription.finalText = "";
    liveTranscription.text = "";
    return;
  }
  if (!speechStartedAt) { answerEl.textContent = "No speech detected yet. Enable an audio source and speak before clicking Answer now."; return; }
  if (recorder.state === "recording") recorder.stop();
  else if (lastAudio) queueAudio(lastAudio);
}

function stopInterview(showSetup = true) {
  liveTranscription?.stop();
  liveTranscription = null;
  clearInterval(cooldownTimer);
  retryRecording = null;
  retryAfter = 0;
  $("#answerNow").textContent = "Answer now";
  $("#answerNow").disabled = false;
  cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (recorder?.state === "recording") {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (systemStream) systemStream.getTracks().forEach(track => track.stop());
  if (micStream) micStream.getTracks().forEach(track => track.stop());
  stream = null;
  systemStream = null;
  micStream = null;
  analyser = null;
  mixerDestination = null;
  audioContext?.close();
  audioContext = null;
  processing = false;
  pendingBlob = null;
  chunks = [];
  lastAudio = null;
  currentQuestion = "";
  awaitingNextQuestion = false;
  updateAudioControls();
  if (showSetup) {
    if (window.cuecard) window.cuecard.minimize();
    else {
      interviewView.classList.add("hidden");
      setupView.classList.remove("hidden");
    }
  }
}

providerEl.addEventListener("change", updateModels);
$("#resumeBtn").addEventListener("click", pickResume);
$("#resumeFile").addEventListener("change", readBrowserResume);
$("#setupForm").addEventListener("submit", beginInterview);
$("#systemAudioToggle").addEventListener("click", toggleSystemAudio);
$("#micAudioToggle").addEventListener("click", toggleMicAudio);
$("#answerNow").addEventListener("click", forceAnswer);
$("#previousAnswer").addEventListener("click", () => { if (historyIndex > 0) { historyIndex--; renderHistory(); } });
$("#nextAnswer").addEventListener("click", () => { if (historyIndex < history.length - 1) { historyIndex++; renderHistory(); } });
$("#hideBtn").addEventListener("click", () => window.cuecard ? window.cuecard.minimize() : window.scrollTo({ top: 0, behavior: "smooth" }));
$("#closeBtn").addEventListener("click", () => window.cuecard ? window.cuecard.close() : window.close());
$("#zoomIn").addEventListener("click", () => { zoom = Math.min(1.35, zoom + .1); document.documentElement.style.zoom = zoom; window.cuecard?.resize(30); });
$("#zoomOut").addEventListener("click", () => { zoom = Math.max(.8, zoom - .1); document.documentElement.style.zoom = zoom; window.cuecard?.resize(-30); });

if (window.cuecard) {
  window.cuecard.onForceAnswer(forceAnswer);
  window.cuecard.onToggleCapture(() => stream ? stopInterview(true) : undefined);
  window.cuecard.onStartSession(session => startOverlaySession(session));
  if (isOverlay) {
    window.cuecard.getPendingSession().then(session => {
      if (session) startOverlaySession(session);
    });
  }
}
updateModels();
if (isOverlay) {
  setupView.classList.add("hidden");
  interviewView.classList.add("hidden");
}
