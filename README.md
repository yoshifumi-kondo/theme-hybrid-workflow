# テーマ抽出・オーバーレイツール

動画から主要なテーマを自動抽出し、タイムスタンプ付きで動画にオーバーレイ表示するツールです。OpenAI API（Whisper と GPT）または Google AI API（Gemini）を使用し、人間によるレビューと修正ステップを含む設計になっています。

## 特徴

- **自動字幕生成**: OpenAI Whisper APIを使用して高精度な字幕を生成
- **AIテーマ抽出**: OpenAI GPTモデルまたはGoogle Geminiモデルで字幕から自動的に主要テーマを抽出
- **Gemini 1.5対応**: 最大100万トークン対応で長い動画も一度に処理可能
- **人間によるレビュー**: 各ステップで確認・修正できるワークフロー
- **シンプルなコマンド**: npm/bunスクリプトによる簡単な操作
- **カスタマイズ可能**: フォントサイズ、背景透明度などの調整が可能

## インストール

```bash
# リポジトリのクローン/ダウンロード
git clone https://github.com/yourusername/theme-hybrid-workflow.git
cd theme-hybrid-workflow

# 依存関係のインストール
bun install
```

## 環境設定

1. `.env` ファイルをプロジェクトルートに作成し、APIキーを設定します:

```bash
# OpenAI API キー（OpenAIモデル使用時に必要）
OPENAI_API_KEY=sk-your-api-key-here

# Google API キー（Geminiモデル使用時に必要）
GOOGLE_API_KEY=your-google-api-key-here

# オプション設定
DEFAULT_LANGUAGE=ja
DEFAULT_FONT_SIZE=24
DEFAULT_BG_OPACITY=0.7
```

2. FFmpegがインストールされていることを確認します:
   - Windows: [FFmpeg.org](https://ffmpeg.org/download.html) からダウンロード
   - Mac: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`

## 使用方法

### 全自動ワークフロー（推奨）

すべてのステップを順番に実行し、人間の確認が必要な場所で一時停止します:

```bash
bun run run-all -i 入力動画.mp4 -d ./プロジェクト名
```

または:

```bash
npm run run-all -- -i 入力動画.mp4 -d ./プロジェクト名
```

### 個別ステップ実行

各ステップを個別に実行することもできます:

```bash
# 1. プロジェクト初期化
bun run init -i 入力動画.mp4 -d ./プロジェクト名

# 2. 字幕抽出
bun run extract-subtitles -p ./プロジェクト名

# 3. 字幕確認・編集
bun run edit-subtitles -p ./プロジェクト名

# 4. テーマ抽出（デフォルトはGemini）
bun run extract-themes -p ./プロジェクト名

# 4. テーマ抽出（特定のモデルを指定）
bun run extract-themes:gemini -p ./プロジェクト名  # Gemini 1.5 Flash
bun run extract-themes:openai -p ./プロジェクト名  # OpenAI GPT-4 Turbo

# 5. テーマ確認・編集
bun run edit-themes -p ./プロジェクト名

# 6. 最終動画作成
bun run create-video -p ./プロジェクト名
```

## コマンドオプション

各コマンドで使用できるオプションの詳細は、ヘルプコマンドで確認できます:

```bash
bun run help
bun run init --help
bun run extract-themes --help
# など
```

### 主なオプション

- `-i, --input <path>`: 入力動画ファイルのパス
- `-d, --dir <path>`: プロジェクトディレクトリ（デフォルト: `./theme-project`）
- `-p, --project <path>`: プロジェクトディレクトリ（個別コマンドで使用）
- `-l, --language <code>`: 動画の言語（デフォルト: `ja`）
- `-k, --api-key <key>`: API キー（.envファイルでも設定可）
- `-m, --model <model>`: AI モデル（デフォルト: `gemini-1.5-flash`）
- `--provider <provider>`: モデルプロバイダー（`google`または`openai`、デフォルト: `google`）
- `-f, --font-size <size>`: フォントサイズ（デフォルト: `24`）
- `-b, --bg-opacity <opacity>`: 背景の不透明度（0-1）（デフォルト: `0.5`）

## 処理の流れ

1. **プロジェクト初期化**: 作業ディレクトリとプロジェクト設定を作成
2. **字幕抽出**: Whisper APIで動画から字幕を生成（SRTファイル）
3. **字幕の確認・編集**: テキストエディタで字幕内容を人間が確認・修正
4. **テーマ抽出**: GeminiまたはGPTモデルが字幕からテーマとタイムコードを抽出
5. **テーマの確認・編集**: テキストエディタでテーマを人間が確認・修正
6. **動画作成**: 確認済みのテーマを元動画にオーバーレイして最終動画を作成

## 各AIモデルの特徴と選び方

### Gemini モデル (デフォルト)

デフォルトではGoogle AI StudioのGemini 1.5 Flashを使用します。

- **Gemini 1.5 Flash**: 高速・低コスト、100万トークンのコンテキストウィンドウ対応
- **Gemini 1.5 Pro**: 高性能・高精度、100万トークンのコンテキストウィンドウ対応
- **Gemini Pro**: 32Kトークンの標準モデル

#### 利点

- 非常に長いコンテキストウィンドウ（字幕を分割せずに処理可能）
- 費用対効果が高い
- 長い動画や講義の処理に最適

```bash
# Gemini 1.5 Flash を使用（デフォルト）
bun run extract-themes -p ./プロジェクト名

# 明示的に Gemini を指定
bun run extract-themes -p ./プロジェクト名 --provider google --model gemini-1.5-flash
```

### OpenAI モデル

- **GPT-3.5-Turbo**: 低コスト、16Kトークン対応
- **GPT-4-Turbo**: 高性能、128Kトークン対応

#### 利点

- 高精度なテーマ抽出が可能
- 細かいニュアンスの理解に優れる

```bash
# GPT-4 Turbo を使用
bun run extract-themes -p ./プロジェクト名 --provider openai --model gpt-4-turbo

# または、ショートカットを使用
bun run extract-themes:openai -p ./プロジェクト名
```

## 例

### 講義動画からトピック抽出 (Gemini使用)

```bash
bun run run-all -i 講義.mp4 -d ./講義プロジェクト -l ja -f 28 -b 0.7
```

### プレゼンテーションからの要点抽出 (GPT-4使用)

```bash
bun run run-all -i プレゼン.mp4 -d ./プレゼン分析 --provider openai -m gpt-4-turbo -f 32
```

### 長時間講座の処理 (Gemini 1.5 Flash使用)

```bash
bun run run-all -i 長時間講座.mp4 -d ./長時間講座 -m gemini-1.5-flash -f 24
```

## トラブルシューティング

- **「API キーが必要です」エラー**: `.env`ファイルまたはコマンドラインで正しいAPIキーを指定
- **「FFmpegが見つかりません」エラー**: FFmpegをインストールしてPATHに追加
- **字幕が生成されない**: 動画の音声品質の確認、または言語設定の確認
- **「Google AI API エラー」**: Google AI StudioでAPIキーを作成し正しく設定
- **テーマ抽出の精度が低い**: より高性能なモデル（GPT-4 TurboやGemini 1.5 Pro）の使用を検討
- **動画処理時のエラー**: FFmpegバージョンの確認、出力先の書き込み権限の確認
- **文字化けの問題**: 日本語フォントがインストールされているか確認

## ライセンス

MIT

## 謝辞

このツールはOpenAI API、Google AI API（Gemini）、およびFFmpegを使用しています。