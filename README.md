# DeepSeek AI 聊天应用

一个基于 DeepSeek API 的智能聊天应用，支持用户注册、登录和聊天记录保存。

## 功能特点

- 🤖 集成 DeepSeek AI 聊天 API
- 👥 用户注册和登录系统
- 💾 聊天记录云端保存
- 🔐 JWT 身份验证
- 📱 响应式设计
- ⚡ 流式对话输出

## 技术栈

- **前端**: HTML5, CSS3, JavaScript (原生)
- **后端**: Node.js, Express.js
- **认证**: JWT, bcrypt
- **数据存储**: JSON 文件存储
- **AI API**: DeepSeek API

## 安装和运行

1. 进入项目目录：
   ```bash
   cd deepseek-chat-app
   ```
2. 安装依赖：
   ```bash
   npm install
   ```
3. 启动服务器（两种方式）：
   ```bash
   # 方式1：使用启动脚本
   ./start.sh
   
   # 方式2：使用npm
   npm start
   ```
4. 打开浏览器访问：`http://localhost:3000`

## 目录结构

```
deepseek-chat-app/
├── index.html          # 登录注册页面
├── chat.html           # 聊天界面
├── server.js           # 后端服务器
├── package.json        # 项目依赖配置
├── start.sh            # 启动脚本
├── README.md           # 使用说明
├── node_modules/       # 依赖包（自动生成）
├── users.json          # 用户数据存储（自动生成）
└── chat_*.json         # 用户聊天记录（自动生成）
```

## API 接口

### 用户认证
- `POST /api/register` - 用户注册
- `POST /api/login` - 用户登录
- `GET /api/verify-token` - 验证 JWT token

### 聊天记录
- `GET /api/chat-history` - 获取聊天历史
- `POST /api/chat-history` - 保存聊天历史

## 环境变量

可以通过环境变量配置：

- `PORT` - 服务器端口（默认：3000）
- `JWT_SECRET` - JWT 密钥（默认：'your-secret-key'）

## 安全特性

- 密码使用 bcrypt 加密存储
- JWT token 身份验证
- 输入验证和错误处理
- CORS 跨域支持

## 使用说明

1. 访问 `http://localhost:3000` 进入登录页面
2. 如果是新用户，点击"注册"标签创建账号
3. 登录成功后自动跳转到聊天界面
4. 输入消息与 AI 进行对话
5. 聊天记录会自动保存，换设备登录后可以查看历史记录

## 注意事项

- 确保网络连接正常，能够访问 DeepSeek API
- 用户数据存储在本地 JSON 文件中，生产环境建议使用数据库
- JWT 密钥在生产环境中应该使用更安全的随机字符串

## 许可证

MIT License