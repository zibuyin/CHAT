const loginView = document.getElementById("loginView");
const chatView = document.getElementById("chatView");
const loginError = document.getElementById("loginError");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const messagesEl = document.getElementById("messages");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const whoami = document.getElementById("whoami");
const countdownEl = document.getElementById("countdown");

let socket = null;
let myName = null;
let sessionExpiresAt = null;
let countdownTimer = null;

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
  sessionExpiresAt = null;
}

function showChat(name, expiresAt) {
  myName = name;
  sessionExpiresAt = expiresAt;
  whoami.textContent = `已登录：${name}`;
  loginView.style.display = "none";
  chatView.style.display = "flex";
  loadHistory();
  connectSocket();
  startCountdown();
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

function renderMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg" + (msg.name === myName ? " self" : "");
  const time = new Date(msg.time).toLocaleTimeString();
  div.innerHTML = `
    <div class="meta">${escapeHtml(msg.name)} · ${time}</div>
    <div class="bubble">${escapeHtml(msg.text)}</div>
  `;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
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
  socket.on("chat:message", renderMessage);
  socket.on("connect_error", () => {
    showLogin("会话已过期，请重新登录");
  });
}

async function login() {
  loginError.textContent = "";
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: passwordInput.value })
  });
  const data = await res.json();
  if (!res.ok) {
    loginError.textContent = data.error || "登录失败";
    return;
  }
  showChat(data.name, data.expiresAt);
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
}

async function checkSession() {
  const res = await fetch("/api/session");
  const data = await res.json();
  if (data.authenticated && data.expiresAt > Date.now()) {
    showChat(data.name, data.expiresAt);
  } else {
    showLogin();
  }
}

function sendMessage() {
  const text = textInput.value.trim();
  if (!text || !socket) return;
  socket.emit("chat:message", text);
  textInput.value = "";
}

loginBtn.addEventListener("click", login);
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

checkSession();
