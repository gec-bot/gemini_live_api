// server.js
// ローカル開発環境でのみdotenvを読み込む
if (process.env.NODE_ENV !== 'production') {
  try {
    const dotenv = await import('dotenv');
    dotenv.config();
    console.log('Loaded .env file for local development');
  } catch (error) {
    console.log('dotenv not available or .env file not found, using environment variables');
  }
}

import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

console.log('Environment check:');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('- GOOGLE_API_KEY:', GOOGLE_API_KEY ? 'SET (length: ' + GOOGLE_API_KEY.length + ')' : 'NOT SET');
console.log('- All env vars:', Object.keys(process.env).filter(k => k.includes('GOOGLE')));

if (!GOOGLE_API_KEY) {
  console.error('Error: GOOGLE_API_KEY is not set in environment variables');
  console.error('Please set GOOGLE_API_KEY in Render dashboard under Environment tab');
  process.exit(1);
}

// (1) APIキー提供（簡易版 - 開発・テスト用）
// 注意: 本番環境ではephemeralトークンを使用すべきですが、
// 現在ephemeralトークンAPIが動作しないため、直接APIキーを使用します
app.post('/api-key', async (req, res) => {
  try {
    console.log('Providing API key for direct connection...');
    res.json({ apiKey: GOOGLE_API_KEY });
  } catch (e) {
    console.error('API key error:', e);
    res.status(500).json({ error: e?.message ?? 'failed to get API key' });
  }
});

// デバッグ用：利用可能なモデルをリスト
app.get('/list-models', async (req, res) => {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`
    );
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t });
    }
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('List models error:', e);
    res.status(500).json({ error: e?.message ?? 'list models error' });
  }
});

// (2) テキスト生成の安全プロキシ（要約/用語チェック用）
app.post('/text-generate', async (req, res) => {
  try {
    const { systemInstruction, userQuery, model = 'models/gemini-2.5-flash' } = req.body;
    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
    };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t.slice(0, 200) });
    }
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    res.json({ text });
  } catch (e) {
    console.error('Text generation error:', e);
    res.status(500).json({ error: e?.message ?? 'proxy error' });
  }
});

// ルートアクセスでindex.htmlを返す
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
