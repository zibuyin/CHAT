const loginView = document.getElementById("loginView");
const chatView = document.getElementById("chatView");
const loginError = document.getElementById("loginError");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const messagesEl = document.getElementById("messages");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const photoBtn = document.getElementById("photoBtn");
const photoInput = document.getElementById("photoInput");
const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");
const burnCheckbox = document.getElementById("burnCheckbox");
const whoami = document.getElementById("whoami");
const countdownEl = document.getElementById("countdown");
const alertToggleBtn = document.getElementById("alertToggleBtn");
const imageModal = document.getElementById("imageModal");
const imageModalImg = document.getElementById("imageModalImg");
const imageModalTimer = document.getElementById("imageModalTimer");
const onlineUsersEl = document.getElementById("onlineUsers");
const replyPreview = document.getElementById("replyPreview");
const replySnippetEl = replyPreview.querySelector(".reply-snippet");
const replyCancelBtn = document.getElementById("replyCancelBtn");

let socket = null;
let myName = null;
let myRoomId = null;
let sessionExpiresAt = null;
let countdownTimer = null;
let sessionUnlimited = false;
let strongAlertEnabled = false;
let audioCtx = null;
let burnCountdownTimer = null;
let currentBurnId = null;
let onlineUsers = [];
let onlineUsersTimer = null;
let windowFocused = true;
let replyingTo = null;
const BURN_VIEW_SECONDS = 5;

function playBeep() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

function triggerStrongAlert() {
  document.body.classList.remove("flash-alert");
  // 强制重新触发动画
  void document.body.offsetWidth;
  document.body.classList.add("flash-alert");
  playBeep();
}

function showLogin(message) {
  loginView.style.display = "block";
  chatView.style.display = "none";
  loginError.textContent = message || "";
  passwordInput.value = "";
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  clearInterval(countdownTimer);
  countdownTimer = null;
  clearInterval(onlineUsersTimer);
  onlineUsersTimer = null;
  onlineUsers = [];
  onlineUsersEl.innerHTML = "";
  sessionExpiresAt = null;
  sessionUnlimited = false;
  strongAlertEnabled = false;
  alertToggleBtn.style.display = "none";
  alertToggleBtn.classList.remove("on");
  alertToggleBtn.textContent = "强提醒：关";
  cancelReply();
}

function showChat(name, roomId, expiresAt, unlimited) {
  myName = name;
  myRoomId = roomId;
  sessionExpiresAt = expiresAt;
  sessionUnlimited = !!unlimited;
  whoami.textContent = `已登录：${name} · 房间：${roomId}`;
  loginView.style.display = "none";
  chatView.style.display = "flex";
  loadHistory();
  connectSocket();
  if (sessionUnlimited) {
    countdownEl.style.display = "none";
    alertToggleBtn.style.display = "inline-block";
  } else {
    countdownEl.style.display = "inline-block";
    alertToggleBtn.style.display = "none";
    startCountdown();
  }
  clearInterval(onlineUsersTimer);
  onlineUsersTimer = setInterval(renderOnlineUsers, 1000);
}

function startCountdown() {
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
}

async function updateCountdown() {
  const remainingMs = sessionExpiresAt - Date.now();
  if (remainingMs <= 0) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    await logout();
    showLogin("5 分钟时间已到，已自动退出，请重新登录");
    return;
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  countdownEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
  countdownEl.classList.toggle("warning", totalSeconds <= 60);
}

function renderOnlineUsers() {
  onlineUsersEl.innerHTML = onlineUsers.map((u) => {
    let timeLabel = "不限时";
    let warning = false;
    if (!u.unlimited) {
      const remainingMs = u.expiresAt - Date.now();
      const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      timeLabel = `${m}:${String(s).padStart(2, "0")}`;
      warning = totalSeconds <= 60;
    }
    // 暂时禁用 focus 状态显示
    // const focusLabel = u.focused ? "👀 专注" : "💤 离开";
    return `<span class="online-user${warning ? " warning" : ""}"><span class="dot"></span>${escapeHtml(u.name)} · ${timeLabel}</span>`;
  }).join("");
}

// 暂时禁用 focus 状态功能
// function reportFocusState() {
//   if (!socket) return;
//   const focused = windowFocused && document.visibilityState !== "hidden";
//   socket.emit("user:focus", focused);
// }


function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function messageSnippet(msg) {
  if (msg.type === "image") return "[图片]";
  if (msg.type === "file") return `[文件] ${msg.fileName || ""}`;
  return (msg.text || "").slice(0, 80);
}

function startReply(msg) {
  replyingTo = { id: msg.id, name: msg.name, snippet: messageSnippet(msg) };
  replySnippetEl.textContent = `回复 ${replyingTo.name}：${replyingTo.snippet}`;
  replyPreview.style.display = "flex";
  textInput.focus();
}

function cancelReply() {
  replyingTo = null;
  replyPreview.style.display = "none";
}

function renderMessage(msg) {
  const div = document.createElement("div");
  const isSelf = msg.name === myName;
  div.className = "msg" + (isSelf ? " self" : "");
  const time = new Date(msg.time).toLocaleTimeString();
  let bubble;
  if (msg.type === "image" && msg.burnAfterReading) {
    bubble = `<div class="bubble image-bubble burn-pending" data-msg-id="${escapeHtml(msg.id)}" data-msg-type="image">
         <img src="${escapeHtml(msg.url)}" alt="图片" />
         <div class="burn-overlay">🔥 阅后即焚<br>点击查看</div>
       </div>`;
  } else if (msg.type === "image") {
    bubble = `<div class="bubble image-bubble view-only" data-msg-id="${escapeHtml(msg.id)}" data-msg-type="image">
         <img src="${escapeHtml(msg.url)}" alt="图片" />
       </div>`;
  } else if (msg.type === "file" && msg.burnAfterReading) {
    bubble = `<div class="bubble text-burn burn-pending" data-msg-id="${escapeHtml(msg.id)}" data-msg-type="file">
         <a class="burn-text" href="${escapeHtml(msg.url)}" download="${escapeHtml(msg.fileName)}" target="_blank">📎 ${escapeHtml(msg.fileName)} (${formatFileSize(msg.fileSize)})</a>
         <div class="burn-overlay">🔥 阅后即焚<br>点击下载</div>
         <div class="burn-timer"></div>
       </div>`;
  } else if (msg.type === "file") {
    bubble = `<a class="bubble file-card" href="${escapeHtml(msg.url)}" download="${escapeHtml(msg.fileName)}" target="_blank">
         <span class="file-icon">📎</span>
         <span class="file-info"><span class="file-name">${escapeHtml(msg.fileName)}</span><span class="file-size">${formatFileSize(msg.fileSize)}</span></span>
       </a>`;
  } else if (msg.burnAfterReading) {
    bubble = `<div class="bubble text-burn burn-pending" data-msg-id="${escapeHtml(msg.id)}" data-msg-type="text">
         <span class="burn-text">${escapeHtml(msg.text)}</span>
         <div class="burn-overlay">🔥 阅后即焚<br>点击查看</div>
         <div class="burn-timer"></div>
       </div>`;
  } else {
    bubble = `<div class="bubble">${escapeHtml(msg.text)}</div>`;
  }
  const quote = msg.replyTo
    ? `<span class="reply-quote">回复 ${escapeHtml(msg.replyTo.name)}：${escapeHtml(msg.replyTo.snippet)}</span>`
    : "";
  div.innerHTML = `
    <div class="meta">${escapeHtml(msg.name)} · ${time}<span class="reply-btn" data-reply-id="${escapeHtml(msg.id)}">↩ 回复</span></div>
    ${quote}
    ${bubble}
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  div.dataset.rawMessage = JSON.stringify(msg);

  if (!isSelf && strongAlertEnabled) triggerStrongAlert();
}

function openImageModal(id, url, burnEnabled) {
  currentBurnId = burnEnabled ? id : null;
  imageModalImg.src = url;
  imageModal.style.display = "flex";
  clearInterval(burnCountdownTimer);
  if (!burnEnabled) {
    imageModalTimer.textContent = "点击关闭";
    burnCountdownTimer = null;
    return;
  }
  let remaining = BURN_VIEW_SECONDS;
  imageModalTimer.textContent = `阅后 ${remaining} 秒自动焚毁，点击可提前关闭`;
  burnCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      closeImageModal();
    } else {
      imageModalTimer.textContent = `阅后 ${remaining} 秒自动焚毁，点击可提前关闭`;
    }
  }, 1000);
}

function closeImageModal() {
  clearInterval(burnCountdownTimer);
  burnCountdownTimer = null;
  imageModal.style.display = "none";
  imageModalImg.src = "";
  const id = currentBurnId;
  currentBurnId = null;
  if (id) {
    fetch(`/api/burn/${id}`, { method: "POST" }).catch(() => {});
  }
}

function revealTextBurn(bubble, id) {
  if (bubble.classList.contains("revealed")) return;
  bubble.classList.add("revealed");
  const timerEl = bubble.querySelector(".burn-timer");
  let remaining = BURN_VIEW_SECONDS;
  const update = () => {
    if (timerEl) timerEl.textContent = `${remaining} 秒后焚毁`;
  };
  update();
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(timer);
      fetch(`/api/burn/${id}`, { method: "POST" }).catch(() => {});
    } else {
      update();
    }
  }, 1000);
}

function markMessageBurned(id) {
  const bubble = messagesEl.querySelector(`[data-msg-id="${id}"]`);
  if (bubble) {
    const type = bubble.dataset.msgType;
    const labels = { image: "🔥 图片已阅后即焚", file: "🔥 文件已阅后即焚" };
    bubble.className = "bubble burned";
    bubble.textContent = labels[type] || "🔥 消息已阅后即焚";
  }
  if (currentBurnId === id) {
    clearInterval(burnCountdownTimer);
    burnCountdownTimer = null;
    currentBurnId = null;
    imageModal.style.display = "none";
    imageModalImg.src = "";
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadHistory() {
  messagesEl.innerHTML = "";
  const res = await fetch("/api/messages");
  if (!res.ok) return;
  const messages = await res.json();
  messages.forEach(renderMessage);
}

function connectSocket() {
  socket = io();
  // socket.on("connect", reportFocusState); // 暂时禁用 focus 状态功能
  socket.on("chat:message", renderMessage);
  socket.on("chat:burn", ({ id }) => markMessageBurned(id));
  socket.on("room:users", (users) => {
    onlineUsers = users;
    renderOnlineUsers();
  });
  socket.on("connect_error", () => {
    showLogin("会话已过期，请重新登录");
  });
}

async function login() {
  loginError.textContent = "";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: passwordInput.value, name: nameInput.value, roomId: roomInput.value })
  });
  const data = await res.json();
  if (!res.ok) {
    loginError.textContent = data.error || "登录失败";
    return;
  }
  showChat(data.name, data.roomId, data.expiresAt, data.unlimited);
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
}

async function checkSession() {
  const res = await fetch("/api/session");
  const data = await res.json();
  if (data.authenticated && (data.unlimited || data.expiresAt > Date.now())) {
    showChat(data.name, data.roomId, data.expiresAt, data.unlimited);
  } else {
    showLogin();
  }
}

function sendMessage() {
  const text = textInput.value.trim();
  if (!text || !socket) return;
  socket.emit("chat:message", { text, burn: burnCheckbox.checked, replyTo: replyingTo });
  textInput.value = "";
  cancelReply();
}

async function sendPhoto(file) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("burn", burnCheckbox.checked ? "1" : "0");
  if (replyingTo) formData.append("replyTo", JSON.stringify(replyingTo));
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "图片上传失败");
  }
  cancelReply();
}

async function sendFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("burn", burnCheckbox.checked ? "1" : "0");
  if (replyingTo) formData.append("replyTo", JSON.stringify(replyingTo));
  const res = await fetch("/api/upload-file", { method: "POST", body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "文件上传失败");
  }
  cancelReply();
}


loginBtn.addEventListener("click", login);
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
logoutBtn.addEventListener("click", async () => {
  await logout();
  showLogin();
});
sendBtn.addEventListener("click", sendMessage);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
photoBtn.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (file) sendPhoto(file);
  photoInput.value = "";
});
fileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) sendFile(file);
  fileInput.value = "";
});
messagesEl.addEventListener("click", (e) => {
  const replyBtn = e.target.closest(".reply-btn");
  if (replyBtn) {
    const msgDiv = replyBtn.closest(".msg");
    const raw = msgDiv && msgDiv.dataset.rawMessage;
    if (raw) startReply(JSON.parse(raw));
    return;
  }
  const textBurnBubble = e.target.closest(".text-burn.burn-pending");
  if (textBurnBubble) {
    revealTextBurn(textBurnBubble, textBurnBubble.dataset.msgId);
    return;
  }
  const imageBubble = e.target.closest(".image-bubble.burn-pending") || e.target.closest(".image-bubble.view-only");
  if (!imageBubble) return;
  const img = imageBubble.querySelector("img");
  openImageModal(imageBubble.dataset.msgId, img.src, imageBubble.classList.contains("burn-pending"));
});
replyCancelBtn.addEventListener("click", cancelReply);
imageModal.addEventListener("click", closeImageModal);
alertToggleBtn.addEventListener("click", () => {
  if (!sessionUnlimited) return;
  strongAlertEnabled = !strongAlertEnabled;
  alertToggleBtn.classList.toggle("on", strongAlertEnabled);
  alertToggleBtn.textContent = strongAlertEnabled ? "强提醒：开" : "强提醒：关";
});
// 暂时禁用 focus 状态功能
// window.addEventListener("focus", () => {
//   windowFocused = true;
//   reportFocusState();
// });
// window.addEventListener("blur", () => {
//   windowFocused = false;
//   reportFocusState();
// });
// document.addEventListener("visibilitychange", reportFocusState);

checkSession();
