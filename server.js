const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const USERS_FILE = path.join(__dirname, 'users.json');
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-111a4f87af724cd4b3a9c3e6bc8f85ab';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// 中间件
app.use(express.json());
app.use(express.static(__dirname));

// 初始化用户数据文件
function initializeUsersFile() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({}));
    }
}

// 读取用户数据
function getUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// 保存用户数据
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    // 验证输入
    if (!username || !password) {
        return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    if (password.length < 6) {
        return res.status(400).json({ message: '密码长度不能少于6位' });
    }
    
    // 检查用户是否已存在
    const users = getUsers();
    if (users[username]) {
        return res.status(400).json({ message: '用户名已存在' });
    }
    
    // 创建新用户
    users[username] = {
        password: hashPassword(password),
        createdAt: new Date().toISOString(),
        chatHistory: []
    };
    
    saveUsers(users);
    
    res.status(201).json({ message: '注册成功' });
});

// 路由：用户登录
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // 验证输入
    if (!username || !password) {
        return res.status(400).json({ message: '用户名和密码不能为空' });
    }
    
    // 检查用户凭据
    const users = getUsers();
    const user = users[username];
    
    if (!user || user.password !== hashPassword(password)) {
        return res.status(401).json({ message: '用户名或密码错误' });
    }
    
    // 生成JWT token
    const token = jwt.sign(
        { username: username },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
    
    res.json({ token, message: '登录成功' });
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
        // 获取用户聊天历史
        const users = getUsers();
        const user = users[req.user.username];
        const chatHistory = user.chatHistory || [];
        
        // 构建消息历史（保持最近10条对话）
        const messages = [
            {
                role: 'system',
                content: '你是一个专门帮助解决生活问题的AI助手。你擅长回答关于日常生活、工作、学习、健康、人际关系等各种生活问题，并提供实用的建议和解决方案。请用中文回答问题，语气友好亲切。'
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
        user.chatHistory.push(
            { role: 'user', content: message },
            { role: 'assistant', content: aiReply }
        );
        
        // 保持历史记录不超过40条消息
        if (user.chatHistory.length > 40) {
            user.chatHistory = user.chatHistory.slice(-40);
        }
        
        saveUsers(users);
        
        res.json({ reply: aiReply });
        
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ message: '聊天服务暂时不可用，请稍后再试' });
    }
});

// 路由：获取聊天历史
app.get('/api/chat-history', verifyToken, (req, res) => {
    const users = getUsers();
    const user = users[req.user.username];
    
    res.json({ history: user.chatHistory || [] });
});

// 路由：保存聊天历史
app.post('/api/chat-history', verifyToken, (req, res) => {
    const { history } = req.body;
    
    const users = getUsers();
    users[req.user.username].chatHistory = history;
    saveUsers(users);
    
    res.json({ message: '聊天历史保存成功' });
});

// 路由：清除聊天历史
app.delete('/api/chat-history', verifyToken, (req, res) => {
    const users = getUsers();
    users[req.user.username].chatHistory = [];
    saveUsers(users);
    
    res.json({ message: '聊天历史清除成功' });
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
initializeUsersFile();
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log('DeepSeek聊天应用已启动');
});