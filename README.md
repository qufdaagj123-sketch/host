# NoirCode Host

Web host chạy **Node.js** và **Python** Discord bot.

- Token nằm **sẵn trong code** (không cần nhập khi tạo bot)
- Có nút **Tải về** (download zip bot)
- Start / Stop + Logs realtime
- Tự `npm install` / `pip install` khi start

## Cấu trúc

```
code-host/
├── package.json
├── server.js              # Backend Express
├── README.md
├── public/
│   └── index.html         # Dashboard
├── data/                  # users.json, bots.json (tự tạo)
└── bots/                  # Mỗi bot 1 thư mục (tự tạo)
    └── <id>/
        ├── index.js       # (Node)
        ├── package.json
        ├── bot.py         # (Python)
        └── requirements.txt
```

## Chạy

```bash
cd code-host
npm install
npm start
```

Mở: **http://localhost:3000**

### Yêu cầu thêm (Python)

- Cài Python 3
- `pip` / `pip3` có sẵn

## Cách dùng

1. Đăng ký tài khoản
2. **+ Tạo bot** → chọn **Node.js** hoặc **Python**
3. Mở bot → tab **Code** → thay `PASTE_YOUR_BOT_TOKEN_HERE` bằng token thật
4. Bấm **Lưu code** → **Start**
5. Xem **Logs**
6. Bấm **⬇ Tải về** để tải zip source bot

## Lưu ý bảo mật

Chỉ dùng **local / VPS riêng**.  
User code chạy trực tiếp bằng `child_process` → không public internet nếu chưa có sandbox (Docker).
