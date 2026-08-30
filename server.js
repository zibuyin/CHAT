const express = require("express");
const session = require("express-session");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { password, sessionTimeoutMs } = require("./config");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MESSAGES_FILE = path.join(__dirname, "messages.json");
const MAX_MESSAGES = 500;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  rolling: false, // 固定过期时间，不因用户操作而延长
  cookie: {
    maxAge: sessionTimeoutMs,
    httpOnly: true,
    sameSite: "lax"
  }
});
app.use(sessionMiddleware);

function loadMessages() {
  try {
    const raw = fs.readFileSync(MESSAGES_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: "未登录或会话已过期" });
}

// 登录
app.post("/api/login", (req, res) => {
  const { password: inputPassword } = req.body || {};
  if (inputPassword !== password) {
    return res.status(401).json({ error: "密码错误" });
  }
  req.session.authenticated = true;
  req.session.name = crypto.randomUUID().slice(0, 8);
  req.session.expiresAt = Date.now() + sessionTimeoutMs;
  res.json({ ok: true, name: req.session.name, expiresAt: req.session.expiresAt });
});

// 退出
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 检查会话状态
app.get("/api/session", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true, name: req.session.name, expiresAt: req.session.expiresAt });
  }
  res.json({ authenticated: false });
});

// 历史消息
app.get("/api/messages", requireAuth, (req, res) => {
  res.json(loadMessages());
});

// 让 socket.io 可以访问 express-session
io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.authenticated) return next();
  next(new Error("未登录"));
});

io.on("connection", (socket) => {
  const name = socket.request.session.name;

  socket.on("chat:message", (text) => {
    if (!socket.request.session.authenticated) return;
    if (typeof text !== "string" || !text.trim()) return;

    const message = {
      name,
      text: text.trim().slice(0, 1000),
      time: Date.now()
    };

    const messages = loadMessages();
    messages.push(message);
    while (messages.length > MAX_MESSAGES) messages.shift();
    saveMessages(messages);

    io.emit("chat:message", message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`聊天服务器已启动: http://localhost:${PORT}`);
});
