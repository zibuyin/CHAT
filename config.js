// 聊天室密码，可通过环境变量 CHAT_PASSWORD 覆盖
module.exports = {
  password: process.env.CHAT_PASSWORD || "letmein123",
  // 特殊密码：登录后不启用超时退出，并解锁强提醒功能（闪屏+提示音）
  specialPassword: process.env.CHAT_SPECIAL_PASSWORD || "XXX",
  // 会话超时时间（毫秒）：5 分钟无操作自动退出
  sessionTimeoutMs: 5 * 60 * 1000
};
