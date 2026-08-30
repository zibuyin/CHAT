const express = require("express");
const session = require("express-session");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { Server } = require("socket.io");
const { password, specialPassword, sessionTimeoutMs } = require("./config");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MESSAGES_FILE = path.join(__dirname, "messages.json");
const MAX_MESSAGES = 500;
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) {
      return cb(new Error("仅支持图片文件"));
    }
    cb(null, true);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  // 避免浏览器缓存旧版前端文件导致行为不一致（例如缓存了没有 name 字段的旧 app.js）
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store")
}));

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
  const { password: inputPassword, name } = req.body || {};
  const isSpecial = inputPassword === specialPassword;
  if (inputPassword !== password && !isSpecial) {
    return res.status(401).json({ error: "密码错误" });
  }
  req.session.authenticated = true;
  const customName = name && String(name).trim().slice(0, 30);
  req.session.name = customName || crypto.randomUUID().slice(0, 8);
  req.session.unlimited = isSpecial;
  if (isSpecial) {
    req.session.expiresAt = null;
    req.session.cookie.maxAge = null; // 不设超时，改为浏览器关闭时失效
  } else {
    req.session.expiresAt = Date.now() + sessionTimeoutMs;
  }
  res.json({
    ok: true,
    name: req.session.name,
    expiresAt: req.session.expiresAt,
    unlimited: req.session.unlimited
  });
});

// 退出
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 检查会话状态
app.get("/api/session", (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({
      authenticated: true,
      name: req.session.name,
      expiresAt: req.session.expiresAt,
      unlimited: !!req.session.unlimited
    });
  }
  res.json({ authenticated: false });
});

// 历史消息
app.get("/api/messages", requireAuth, (req, res) => {
  res.json(loadMessages());
});

// 上传图片
app.post("/api/upload", requireAuth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "上传失败" });
    if (!req.file) return res.status(400).json({ error: "未收到文件" });

    const message = {
      id: crypto.randomUUID(),
      name: req.session.name,
      type: "image",
      url: `/uploads/${req.file.filename}`,
      burnAfterReading: req.body.burn === "1" || req.body.burn === "true",
      time: Date.now()
    };

    const messages = loadMessages();
    messages.push(message);
    while (messages.length > MAX_MESSAGES) messages.shift();
    saveMessages(messages);

    io.emit("chat:message", message);
    res.json({ ok: true });
  });
});

// 阅后即焚：查看过一次后删除图片消息（服务器文件 + 历史记录），并广播给所有客户端
app.post("/api/burn/:id", requireAuth, (req, res) => {
  const messages = loadMessages();
  const index = messages.findIndex((m) => m.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "消息不存在或已焚毁" });
  if (!messages[index].burnAfterReading) return res.status(400).json({ error: "该消息未开启阅后即焚" });

  const [message] = messages.splice(index, 1);
  if (message.type === "image" && message.url) {
    const filePath = path.join(UPLOADS_DIR, path.basename(message.url));
    fs.unlink(filePath, () => {});
  }
  saveMessages(messages);

  io.emit("chat:burn", { id: message.id });
  res.json({ ok: true });
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

  socket.on("chat:message", (payload) => {
    if (!socket.request.session.authenticated) return;
    const text = typeof payload === "string" ? payload : payload && payload.text;
    const burn = typeof payload === "object" && payload !== null && payload.burn === true;
    if (typeof text !== "string" || !text.trim()) return;

    const message = {
      id: crypto.randomUUID(),
      name,
      type: "text",
      text: text.trim().slice(0, 1000),
      burnAfterReading: burn,
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
