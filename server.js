/**
 * NoirCode Host
 * Host & chạy code Node.js + Python (Discord bot)
 * Token nằm sẵn trong code → không cần nhập khi tạo bot
 *
 * Chạy: npm install && npm start
 * Mở: http://localhost:3000
 */

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const archiver = require('archiver');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BOTS_DIR = path.join(ROOT, 'bots');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BOTS_META = path.join(DATA_DIR, 'bots.json');

[DATA_DIR, BOTS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(BOTS_META)) fs.writeFileSync(BOTS_META, '{}');

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));
app.use(session({
  secret: 'noircode-host-secret-' + Date.now(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// botId -> { process, logs: [] }
const running = new Map();

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Chưa đăng nhập' });
  next();
}

// ============ AUTH ============
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc mật khẩu' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    const users = readJSON(USERS_FILE, []);
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Username đã tồn tại' });
    const hash = await bcrypt.hash(password, 10);
    const user = { id: uuidv4(), username, email: email || '', password: hash, createdAt: Date.now() };
    users.push(user);
    writeJSON(USERS_FILE, users);
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = readJSON(USERS_FILE, []);
    const user = users.find(u => u.username === username || u.email === username);
    if (!user) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const users = readJSON(USERS_FILE, []);
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User không tồn tại' });
  res.json({ id: user.id, username: user.username, email: user.email });
});

// ============ BOTS ============
const NODE_SAMPLE = `const { Client, GatewayIntentBits } = require('discord.js');

// ========== TOKEN CỦA BẠN (đã có sẵn trong code) ==========
const TOKEN = 'PASTE_YOUR_BOT_TOKEN_HERE';
// ==========================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log('✅ Bot online: ' + client.user.tag);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;
  if (message.content === '!ping') {
    message.reply('Pong! 🏓 (Node.js)');
  }
  if (message.content === '!info') {
    message.reply('Bot đang chạy trên **NoirCode Host**');
  }
});

client.login(TOKEN);
`;

const PYTHON_SAMPLE = `import discord
from discord.ext import commands

# ========== TOKEN CỦA BẠN (đã có sẵn trong code) ==========
TOKEN = "PASTE_YOUR_BOT_TOKEN_HERE"
# ==========================================================

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"✅ Bot online: {bot.user}")

@bot.command()
async def ping(ctx):
    await ctx.send("Pong! 🏓 (Python)")

@bot.command()
async def info(ctx):
    await ctx.send("Bot đang chạy trên **NoirCode Host**")

bot.run(TOKEN)
`;

app.get('/api/bots', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const list = Object.values(meta)
    .filter(b => b.ownerId === req.session.userId)
    .map(b => ({
      ...b,
      running: running.has(b.id)
    }));
  res.json(list);
});

app.post('/api/bots', requireAuth, (req, res) => {
  try {
    const { name, language, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Thiếu tên bot' });
    const lang = (language || 'node').toLowerCase();
    if (lang !== 'node' && lang !== 'python') {
      return res.status(400).json({ error: 'Chỉ hỗ trợ node hoặc python' });
    }

    const id = uuidv4();
    const botDir = path.join(BOTS_DIR, id);
    fs.mkdirSync(botDir, { recursive: true });

    if (lang === 'node') {
      fs.writeFileSync(path.join(botDir, 'index.js'), NODE_SAMPLE);
      fs.writeFileSync(path.join(botDir, 'package.json'), JSON.stringify({
        name: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
        version: '1.0.0',
        main: 'index.js',
        dependencies: { 'discord.js': '^14.15.3' }
      }, null, 2));
    } else {
      fs.writeFileSync(path.join(botDir, 'bot.py'), PYTHON_SAMPLE);
      fs.writeFileSync(path.join(botDir, 'requirements.txt'), 'discord.py>=2.3.2\n');
    }

    const meta = readJSON(BOTS_META, {});
    meta[id] = {
      id,
      name,
      language: lang,
      description: description || '',
      ownerId: req.session.userId,
      ownerName: req.session.username,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'stopped'
    };
    writeJSON(BOTS_META, meta);

    res.json({ success: true, bot: { id, name, language: lang } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Không tạo được bot' });
  }
});

app.get('/api/bots/:id', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  const botDir = path.join(BOTS_DIR, bot.id);
  let code = '';
  let filename = 'index.js';
  if (bot.language === 'python') {
    filename = 'bot.py';
    const p = path.join(botDir, 'bot.py');
    if (fs.existsSync(p)) code = fs.readFileSync(p, 'utf8');
  } else {
    const p = path.join(botDir, 'index.js');
    if (fs.existsSync(p)) code = fs.readFileSync(p, 'utf8');
  }
  res.json({ ...bot, code, filename, running: running.has(bot.id) });
});

app.put('/api/bots/:id/code', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  const { code } = req.body;
  if (typeof code !== 'string') return res.status(400).json({ error: 'Code không hợp lệ' });
  const botDir = path.join(BOTS_DIR, bot.id);
  const file = bot.language === 'python' ? 'bot.py' : 'index.js';
  fs.writeFileSync(path.join(botDir, file), code);
  bot.updatedAt = Date.now();
  writeJSON(BOTS_META, meta);
  res.json({ success: true });
});

app.put('/api/bots/:id', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  const { name, description } = req.body;
  if (name) bot.name = name;
  if (description !== undefined) bot.description = description;
  bot.updatedAt = Date.now();
  writeJSON(BOTS_META, meta);
  res.json({ success: true });
});

app.delete('/api/bots/:id', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  if (running.has(bot.id)) {
    try { running.get(bot.id).process.kill('SIGTERM'); } catch {}
    running.delete(bot.id);
  }
  const botDir = path.join(BOTS_DIR, bot.id);
  if (fs.existsSync(botDir)) fs.rmSync(botDir, { recursive: true, force: true });
  delete meta[bot.id];
  writeJSON(BOTS_META, meta);
  res.json({ success: true });
});

// ============ START / STOP ============
function pushLog(botId, type, text) {
  const entry = running.get(botId);
  if (!entry) return;
  entry.logs.push({ type, text: String(text), time: Date.now() });
  if (entry.logs.length > 400) entry.logs.shift();
}

app.post('/api/bots/:id/start', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  if (running.has(bot.id)) {
    return res.status(400).json({ error: 'Bot đang chạy rồi' });
  }

  const botDir = path.join(BOTS_DIR, bot.id);
  const logs = [];

  try {
    if (bot.language === 'node') {
      // Auto install nếu chưa có node_modules
      const nm = path.join(botDir, 'node_modules');
      if (!fs.existsSync(nm)) {
        try {
          execSync('npm install --omit=dev', { cwd: botDir, stdio: 'pipe', timeout: 180000 });
        } catch (e) {
          // vẫn cho chạy, có thể user tự cài
        }
      }
      const child = spawn('node', ['index.js'], {
        cwd: botDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      running.set(bot.id, { process: child, logs });
      child.stdout.on('data', d => pushLog(bot.id, 'out', d));
      child.stderr.on('data', d => pushLog(bot.id, 'err', d));
      child.on('close', code => {
        pushLog(bot.id, 'sys', `Process exited with code ${code}`);
        running.delete(bot.id);
        bot.status = 'stopped';
        writeJSON(BOTS_META, meta);
      });
      child.on('error', err => {
        pushLog(bot.id, 'err', 'Failed to start: ' + err.message);
        running.delete(bot.id);
      });
    } else {
      // Python
      const reqFile = path.join(botDir, 'requirements.txt');
      // Thử cài requirements (không bắt buộc thành công)
      try {
        if (fs.existsSync(reqFile)) {
          execSync('pip3 install -r requirements.txt --user -q', {
            cwd: botDir, stdio: 'pipe', timeout: 180000
          });
        }
      } catch (e) {
        // ignore
      }

      const py = process.platform === 'win32' ? 'python' : 'python3';
      const child = spawn(py, ['bot.py'], {
        cwd: botDir,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      running.set(bot.id, { process: child, logs });
      child.stdout.on('data', d => pushLog(bot.id, 'out', d));
      child.stderr.on('data', d => pushLog(bot.id, 'err', d));
      child.on('close', code => {
        pushLog(bot.id, 'sys', `Process exited with code ${code}`);
        running.delete(bot.id);
        bot.status = 'stopped';
        writeJSON(BOTS_META, meta);
      });
      child.on('error', err => {
        pushLog(bot.id, 'err', 'Failed to start: ' + err.message + ' (cần cài Python 3?)');
        running.delete(bot.id);
      });
    }

    bot.status = 'running';
    writeJSON(BOTS_META, meta);
    pushLog(bot.id, 'sys', `▶ Started (${bot.language})`);
    res.json({ success: true, message: 'Bot đã khởi động' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Không start được: ' + e.message });
  }
});

app.post('/api/bots/:id/stop', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  if (!running.has(bot.id)) {
    return res.status(400).json({ error: 'Bot không đang chạy' });
  }
  try {
    running.get(bot.id).process.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    if (running.has(bot.id)) {
      try { running.get(bot.id).process.kill('SIGKILL'); } catch {}
      running.delete(bot.id);
    }
  }, 2000);
  running.delete(bot.id);
  bot.status = 'stopped';
  writeJSON(BOTS_META, meta);
  res.json({ success: true });
});

app.get('/api/bots/:id/logs', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  const entry = running.get(bot.id);
  res.json(entry ? entry.logs : []);
});

// ============ DOWNLOAD BOT AS ZIP ============
app.get('/api/bots/:id/download', requireAuth, (req, res) => {
  const meta = readJSON(BOTS_META, {});
  const bot = meta[req.params.id];
  if (!bot || bot.ownerId !== req.session.userId) {
    return res.status(404).json({ error: 'Không tìm thấy bot' });
  }
  const botDir = path.join(BOTS_DIR, bot.id);
  if (!fs.existsSync(botDir)) {
    return res.status(404).json({ error: 'Thư mục bot không tồn tại' });
  }

  const safeName = (bot.name || 'bot').replace(/[^a-zA-Z0-9-_]/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${bot.language}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', err => {
    console.error(err);
    res.status(500).end();
  });
  archive.pipe(res);

  // Thêm file, bỏ node_modules cho nhẹ
  archive.glob('**/*', {
    cwd: botDir,
    ignore: ['node_modules/**', '**/__pycache__/**', '**/*.pyc']
  });
  archive.finalize();
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 NoirCode Host: http://localhost:${PORT}`);
  console.log(`   Hỗ trợ: Node.js + Python Discord bots\n`);
});
