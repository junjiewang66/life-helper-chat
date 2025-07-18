const express = require('express');
  const path = require('path');
  const crypto = require('crypto');
  const jwt = require('jsonwebtoken');
  const { Pool } = require('pg');

  const app = express();
  const PORT = process.env.PORT || 3000;

  // 配置
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-111a4f87af724cd4b3a9c3e6bc8f85ab';
  const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

  // PostgreSQL连接配置
  const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  // 中间件
  app.use(express.json());
  app.use(express.static(__dirname));

  // 初始化数据库表
  async function initializeDatabase() {
      try {
          // 创建用户表
          await pool.query(`
              CREATE TABLE IF NOT EXISTS users (
                  id SERIAL PRIMARY KEY,
                  username VARCHAR(50) UNIQUE NOT NULL,
                  password VARCHAR(255) NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  chat_history JSONB DEFAULT '[]',
                  plan_type VARCHAR(20) DEFAULT 'free',
                  questions_used INTEGER DEFAULT 0,
                  questions_limit INTEGER DEFAULT 5,
                  plan_expires_at TIMESTAMP DEFAULT NULL
              )
          `);

          // 如果表已存在，添加新列（兼容现有数据）
          await pool.query(`
              ALTER TABLE users
              ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'free',
              ADD COLUMN IF NOT EXISTS questions_used INTEGER DEFAULT 0,
              ADD COLUMN IF NOT EXISTS questions_limit INTEGER DEFAULT 5,
              ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP DEFAULT NULL
          `);
          console.log('Database tables initialized successfully');
      } catch (error) {
          console.error('Database initialization error:', error);
      }
  }

  // 生成密码哈希
  function hashPassword(password) {
      return crypto.createHash('sha256').update(password).digest('hex');
  }

  // 验证JWT token
  function verifyToken(req, res, next) {
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
          return res.status(401).json({ message: '未提供认证令牌' });
      }

      try {
          const decoded = jwt.verify(token, JWT_SECRET);
          req.user = decoded;
          next();
      } catch (error) {
          return res.status(401).json({ message: '无效的认证令牌' });
      }
  }

  // 路由：用户注册
  app.post('/api/register', async (req, res) => {
      const { username, password } = req.body;

      // 验证输入
      if (!username || !password) {
          return res.status(400).json({ message: '用户名和密码不能为空' });
      }

      if (password.length < 6) {
          return res.status(400).json({ message: '密码长度不能少于6位' });
      }

      try {
          // 检查用户是否已存在
          const existingUser = await pool.query(
              'SELECT username FROM users WHERE username = $1',
              [username]
          );

          if (existingUser.rows.length > 0) {
              return res.status(400).json({ message: '用户名已存在' });
          }

          // 创建新用户
          await pool.query(
              'INSERT INTO users (username, password) VALUES ($1, $2)',
              [username, hashPassword(password)]
          );

          res.status(201).json({ message: '注册成功' });
      } catch (error) {
          console.error('Registration error:', error);
          res.status(500).json({ message: '服务器内部错误' });
      }
  });

  // 路由：用户登录
  app.post('/api/login', async (req, res) => {
      const { username, password } = req.body;

      // 验证输入
      if (!username || !password) {
          return res.status(400).json({ message: '用户名和密码不能为空' });
      }

      try {
          // 检查用户凭据
          const user = await pool.query(
              'SELECT username, password FROM users WHERE username = $1',
              [username]
          );

          if (user.rows.length === 0 || user.rows[0].password !== hashPassword(password)) {
              return res.status(401).json({ message: '用户名或密码错误' });
          }

          // 生成JWT token
          const token = jwt.sign(
              { username: username },
              JWT_SECRET,
              { expiresIn: '24h' }
          );

          res.json({ token, message: '登录成功' });
      } catch (error) {
          console.error('Login error:', error);
          res.status(500).json({ message: '服务器内部错误' });
      }
  });

  // 路由：验证token
  app.get('/api/verify-token', verifyToken, (req, res) => {
      res.json({ valid: true, username: req.user.username });
  });

  // 路由：聊天
  app.post('/api/chat', verifyToken, async (req, res) => {
      const { message } = req.body;

      if (!message) {
          return res.status(400).json({ message: '消息不能为空' });
      }

      try {
          // 获取用户信息（包括套餐和问题限制）
          const userResult = await pool.query(
              'SELECT chat_history, plan_type, questions_used, questions_limit FROM users WHERE username = $1',
              [req.user.username]
          );

          const user = userResult.rows[0];
          if (!user) {
              return res.status(404).json({ message: '用户不存在' });
          }

          // 检查用户是否超过问题限制
          if (user.questions_used >= user.questions_limit) {
              return res.status(403).json({
                  message: '您已达到当前套餐的问题限制，请升级套餐以继续使用',
                  needUpgrade: true,
                  currentPlan: user.plan_type,
                  questionsUsed: user.questions_used,
                  questionsLimit: user.questions_limit
              });
          }

          const chatHistory = user.chat_history || [];

          // 构建消息历史（保持最近10条对话）
          const messages = [
              {
                  role: 'system',
                  content:
  '你是一个专门帮助解决生活问题的AI助手。你擅长回答关于日常生活、工作、学习、健康、人际关系等各种生活问题，并提供实用的建议和解决方案。请用中文回答问题，语气友好亲切。'
              },
              ...chatHistory.slice(-20),
              {
                  role: 'user',
                  content: message
              }
          ];

          // 调用DeepSeek API
          const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
              },
              body: JSON.stringify({
                  model: 'deepseek-chat',
                  messages: messages,
                  stream: false
              })
          });

          if (!response.ok) {
              throw new Error(`DeepSeek API请求失败: ${response.status}`);
          }

          const data = await response.json();
          const aiReply = data.choices[0].message.content;

          // 更新用户聊天历史
          const newChatHistory = [
              ...chatHistory,
              { role: 'user', content: message },
              { role: 'assistant', content: aiReply }
          ];

          // 保持历史记录不超过40条消息
          const trimmedHistory = newChatHistory.length > 40
              ? newChatHistory.slice(-40)
              : newChatHistory;

          // 更新聊天历史和增加问题计数
          await pool.query(
              'UPDATE users SET chat_history = $1, questions_used = questions_used + 1 WHERE username = $2',
              [JSON.stringify(trimmedHistory), req.user.username]
          );

          res.json({ reply: aiReply });

      } catch (error) {
          console.error('Chat error:', error);
          res.status(500).json({ message: '聊天服务暂时不可用，请稍后再试' });
      }
  });

  // 路由：获取聊天历史
  app.get('/api/chat-history', verifyToken, async (req, res) => {
      try {
          const result = await pool.query(
              'SELECT chat_history FROM users WHERE username = $1',
              [req.user.username]
          );

          const history = result.rows[0]?.chat_history || [];
          res.json({ history });
      } catch (error) {
          console.error('Get chat history error:', error);
          res.status(500).json({ message: '获取聊天历史失败' });
      }
  });

  // 路由：保存聊天历史
  app.post('/api/chat-history', verifyToken, async (req, res) => {
      const { history } = req.body;

      try {
          await pool.query(
              'UPDATE users SET chat_history = $1 WHERE username = $2',
              [JSON.stringify(history), req.user.username]
          );

          res.json({ message: '聊天历史保存成功' });
      } catch (error) {
          console.error('Save chat history error:', error);
          res.status(500).json({ message: '保存聊天历史失败' });
      }
  });

  // 路由：清除聊天历史
  app.delete('/api/chat-history', verifyToken, async (req, res) => {
      try {
          await pool.query(
              'UPDATE users SET chat_history = $1 WHERE username = $2',
              ['[]', req.user.username]
          );

          res.json({ message: '聊天历史清除成功' });
      } catch (error) {
          console.error('Clear chat history error:', error);
          res.status(500).json({ message: '清除聊天历史失败' });
      }
  });

  // 路由：获取用户状态
  app.get('/api/user-status', verifyToken, async (req, res) => {
      try {
          const result = await pool.query(
              'SELECT plan_type, questions_used, questions_limit, plan_expires_at FROM users WHERE username = $1',
              [req.user.username]
          );

          const user = result.rows[0];
          if (!user) {
              return res.status(404).json({ message: '用户不存在' });
          }

          res.json({
              planType: user.plan_type,
              questionsUsed: user.questions_used,
              questionsLimit: user.questions_limit,
              planExpiresAt: user.plan_expires_at,
              remainingQuestions: user.questions_limit - user.questions_used
          });
      } catch (error) {
          console.error('Get user status error:', error);
          res.status(500).json({ message: '获取用户状态失败' });
      }
  });

  // 管理员密码（实际项目中应该使用环境变量）
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

  // 路由：管理员升级用户套餐
  app.post('/api/admin/upgrade-user', async (req, res) => {
      const { adminPassword, username, planType } = req.body;

      // 验证管理员密码
      if (adminPassword !== ADMIN_PASSWORD) {
          return res.status(401).json({ message: '管理员密码错误' });
      }

      // 验证输入
      if (!username || !planType) {
          return res.status(400).json({ message: '用户名和套餐类型不能为空' });
      }

      // 定义套餐限制
      const planLimits = {
          'free': 5,
          'basic': 10,
          'premium': 15
      };

      if (!planLimits[planType]) {
          return res.status(400).json({ message: '无效的套餐类型' });
      }

      try {
          // 检查用户是否存在
          const userCheck = await pool.query(
              'SELECT username FROM users WHERE username = $1',
              [username]
          );

          if (userCheck.rows.length === 0) {
              return res.status(404).json({ message: '用户不存在' });
          }

          // 升级用户套餐
          const newLimit = planLimits[planType];
          const expiresAt = planType === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30天后过期

          await pool.query(
              'UPDATE users SET plan_type = $1, questions_used = 0, questions_limit = $2, plan_expires_at = $3 WHERE username = $4',
              [planType, newLimit, expiresAt, username]
          );

          res.json({
              message: '用户套餐升级成功',
              username: username,
              newPlan: planType,
              newLimit: newLimit,
              expiresAt: expiresAt
          });
      } catch (error) {
          console.error('Upgrade user error:', error);
          res.status(500).json({ message: '升级用户失败' });
      }
  });

  // 路由：管理员获取所有用户信息
  app.post('/api/admin/users', async (req, res) => {
      const { adminPassword } = req.body;

      // 验证管理员密码
      if (adminPassword !== ADMIN_PASSWORD) {
          return res.status(401).json({ message: '管理员密码错误' });
      }

      try {
          const result = await pool.query(
              'SELECT username, plan_type, questions_used, questions_limit, plan_expires_at, created_at FROM users ORDER BY created_at DESC'
          );

          res.json({ users: result.rows });
      } catch (error) {
          console.error('Get users error:', error);
          res.status(500).json({ message: '获取用户列表失败' });
      }
  });

  // 默认路由
  app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'login.html'));
  });

  // 错误处理中间件
  app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({ message: '服务器内部错误' });
  });

  // 启动服务器
  async function startServer() {
      await initializeDatabase();
      app.listen(PORT, () => {
          console.log(`服务器运行在 http://localhost:${PORT}`);
          console.log('生活问题解决助手已启动 (PostgreSQL版本)');
      });
  }

  startServer().catch(error => {
      console.error('服务器启动失败:', error);
      process.exit(1);
  });
