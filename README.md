# Gemini Live リアルタイム文字起こし

Google Gemini Live APIを使用したリアルタイム音声文字起こしアプリケーションです。

## 機能

- 🎤 リアルタイム音声文字起こし
- ✨ 要約生成
- ✨ 専門用語の抽出と説明

## 必要要件

- Node.js 18以上
- Google Gemini API キー（[こちら](https://ai.google.dev/)から取得）

## ローカル開発

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example`をコピーして`.env`ファイルを作成し、Google API Keyを設定します：

```bash
cp .env.example .env
```

`.env`ファイルを編集：

```
GOOGLE_API_KEY=your_actual_api_key_here
```

### 3. サーバーの起動

```bash
npm start
```

ブラウザで `http://localhost:3000` にアクセスしてください。

## Renderへのデプロイ

### 1. GitHubリポジトリの作成

プロジェクトをGitHubリポジトリにプッシュします：

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/yourusername/your-repo.git
git push -u origin main
```

### 2. Renderでの設定

1. [Render](https://render.com/)にログイン
2. "New +" → "Web Service"をクリック
3. GitHubリポジトリを接続
4. 以下の設定を入力：

   - **Name**: `gemini-live-transcription`（任意の名前）
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`（または任意のプラン）

5. "Advanced" → "Add Environment Variable"をクリック
   - **Key**: `GOOGLE_API_KEY`
   - **Value**: `あなたのGoogle API Key`

6. "Create Web Service"をクリック

### 3. デプロイ完了

数分後、Renderが提供するURLでアプリケーションにアクセスできます。

例: `https://gemini-live-transcription.onrender.com`

## 使用方法

1. ブラウザで `https://your-app.onrender.com` にアクセス
2. 「🎤 文字起こし開始」ボタンをクリック
3. マイクへのアクセスを許可
4. 話すと、リアルタイムで文字起こしが表示されます
5. 「⏹ 停止」ボタンをクリックして文字起こしを停止
6. 「✨ 要約を生成」または「✨ 専門用語をチェック」で分析を実行

## 注意事項

- このアプリケーションは、Google Gemini Live APIを使用しています
- APIキーはサーバー側で管理されますが、ブラウザに送信されるため、本番環境では適切なセキュリティ対策（ephemeralトークンの使用など）を検討してください
- Renderの無料プランでは、15分間アクティビティがないとスリープ状態になります

## ファイル構成

```
.
├── server.js           # Expressサーバー
├── package.json        # 依存関係とスクリプト
├── public/
│   └── index.html      # フロントエンド
├── .env.example        # 環境変数のサンプル
├── .gitignore          # Git除外設定
└── README.md           # このファイル
```

## ライセンス

MIT
