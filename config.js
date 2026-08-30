// 聊天室密码，可通过环境变量 CHAT_PASSWORD 覆盖
module.exports = {
  password: process.env.CHAT_PASSWORD || "letmein123",
  // 会话超时时间（毫秒）：5 分钟无操作自动退出
  sessionTimeoutMs: 5 * 60 * 1000
};
