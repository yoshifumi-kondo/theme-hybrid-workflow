#!/usr/bin/env bun
import { spawn } from 'child_process';
import { join, basename, dirname } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { program } from 'commander';
import open from 'open';

// Bunは自動的に.envファイルを読み込みます
if (existsSync('.env')) {
  console.log('✅ .envファイルを読み込みました');
} else {
  console.log('⚠️ .envファイルが見つかりません。コマンドラインオプションまたは環境変数で指定してください。');
}

// 型定義
interface ThemeEntry {
  start: string;
  end: string;
  theme: string;
}

interface ProjectConfig {
  projectDir: string;
  videoFile: string;
  srtFile: string;
  themesFile: string;
  outputFile: string;
  language: string;
  apiKey: string;
  model: string;
  modelProvider: string; // 'openai' または 'google'
  fontSize: number;
  bgOpacity: number;
}

// コマンドラインオプションの設定
program
  .name('theme-workflow')
  .description('人間の確認ステップを含むテーマ抽出ワークフロー (OpenAI APIのみ使用)')
  .version('1.0.0');

// サブコマンド: プロジェクト初期化
program
  .command('init')
  .description('新しいプロジェクトを作成')
  .requiredOption('-i, --input <path>', '入力動画ファイル')
  .option('-d, --dir <path>', 'プロジェクトディレクトリ', './theme-project')
  .option('-l, --language <code>', '動画の言語', 'ja')
  .action(async (options) => {
    await initProject(options.input, options.dir, options.language);
  });

// サブコマンド: 字幕抽出
program
  .command('extract-subtitles')
  .description('動画から字幕を抽出 (Whisper API)')
  .requiredOption('-p, --project <path>', 'プロジェクトディレクトリ')
  .option('-k, --api-key <key>', 'OpenAI APIキー')
  .action(async (options) => {
    await extractSubtitles(options.project, options.apiKey);
  });

// サブコマンド: 字幕確認用エディタを開く
program
  .command('edit-subtitles')
  .description('字幕ファイルをテキストエディタで開く')
  .requiredOption('-p, --project <path>', 'プロジェクトディレクトリ')
  .action(async (options) => {
    await openSubtitlesEditor(options.project);
  });

// サブコマンド: テーマ抽出
program
  .command('extract-themes')
  .description('字幕からテーマを抽出 (GPT/Gemini API)')
  .requiredOption('-p, --project <path>', 'プロジェクトディレクトリ')
  .option('-k, --api-key <key>', 'OpenAI/Google APIキー')
  .option('-m, --model <model>', 'AIモデル', 'gemini-1.5-flash')
  .option('--provider <provider>', 'モデルプロバイダー (openai/google)', 'google')
  .action(async (options) => {
    await extractThemes(options.project, options.apiKey, options.model, options.provider);
  });

// サブコマンド: テーマ確認用エディタを開く
program
  .command('edit-themes')
  .description('テーマJSONファイルをエディタで開く')
  .requiredOption('-p, --project <path>', 'プロジェクトディレクトリ')
  .action(async (options) => {
    await openThemesEditor(options.project);
  });

// サブコマンド: 動画へのオーバーレイ適用
program
  .command('create-video')
  .description('確認済みのテーマで動画を作成')
  .requiredOption('-p, --project <path>', 'プロジェクトディレクトリ')
  .option('-f, --font-size <size>', 'フォントサイズ', '36')
  .option('-b, --bg-opacity <opacity>', '背景の不透明度 (0-1)', '0.5')
  .option('--fade <seconds>', 'フェードイン/アウト時間（秒）', '0.5')
  .option('--bg-style <style>', '背景スタイル (box/blur/shadow)', 'box')
  .action(async (options) => {
    await createFinalVideo(
      options.project,
      parseInt(options.fontSize),
      parseFloat(options.bgOpacity),
      {
        fadeTime: parseFloat(options.fade),
        bgStyle: options.bgStyle
      }
    );
  });

// サブコマンド: すべてのステップを一度に実行（確認ポイントあり）
program
  .command('run-all')
  .description('すべてのステップを順番に実行（確認ポイントあり）')
  .requiredOption('-i, --input <path>', '入力動画ファイル')
  .option('-d, --dir <path>', 'プロジェクトディレクトリ', './theme-project')
  .option('-l, --language <code>', '動画の言語', 'ja')
  .option('-k, --api-key <key>', 'API キー（OpenAI または Google）')
  .option('-m, --model <model>', 'AIモデル', 'gemini-1.5-flash')
  .option('--provider <provider>', 'モデルプロバイダー (openai/google)', 'google')
  .option('-f, --font-size <size>', 'フォントサイズ', '24')
  .option('-b, --bg-opacity <opacity>', '背景の不透明度 (0-1)', '0.5')
  .action(async (options) => {
    await runAllSteps(
      options.input,
      options.dir,
      options.language,
      options.apiKey,
      options.model,
      options.provider,
      parseInt(options.fontSize),
      parseFloat(options.bgOpacity)
    );
  });

program.parse();

// プロジェクト初期化関数
async function initProject(videoPath: string, projectDir: string, language: string): Promise<void> {
  // プロジェクトディレクトリが存在しない場合は作成
  if (!existsSync(projectDir)) {
    await mkdir(projectDir, { recursive: true });
  }

  // 設定ファイルパス
  const configPath = join(projectDir, 'config.json');
  
  // 既存の設定ファイルがある場合は読み込む
  let config: ProjectConfig;
  
  if (existsSync(configPath)) {
    const content = await readFile(configPath, 'utf-8');
    config = JSON.parse(content) as ProjectConfig;
  } else {
    // 入力動画ファイルのパス
    const videoFileName = basename(videoPath);
    
    // 新しい設定を作成
    config = {
      projectDir,
      videoFile: videoPath,
      srtFile: join(projectDir, `${videoFileName}.srt`),
      themesFile: join(projectDir, 'themes.json'),
      outputFile: join(projectDir, `${videoFileName.replace(/\.[^/.]+$/, '')}_with_themes.mp4`),
      language,
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4',
      modelProvider: 'openai',
      fontSize: 36,
      bgOpacity: 0.5
    };
  }
  
  // 設定をJSON形式で保存
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  
  console.log('プロジェクト初期化が完了しました！');
  console.log('次のステップ:');
  console.log(`1. 字幕を抽出: bun run index.ts extract-subtitles -p ${projectDir}`);
}

// 設定ファイルを読み込む関数
async function loadConfig(projectDir: string): Promise<ProjectConfig> {
  try {
    const configPath = join(projectDir, 'project_config.json');
    if (!existsSync(configPath)) {
      throw new Error(`プロジェクト設定ファイルが見つかりません: ${configPath}`);
    }
    
    const configContent = await readFile(configPath, 'utf-8');
    return JSON.parse(configContent) as ProjectConfig;
  } catch (error) {
    console.error(`設定ファイルの読み込み中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// 設定ファイルを更新する関数
async function updateConfig(config: ProjectConfig): Promise<void> {
  try {
    const configPath = join(config.projectDir, 'project_config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error(`設定ファイルの更新中にエラーが発生しました: ${(error as Error).message}`);
  }
}

// 字幕抽出関数 - ファイルサイズ制限対応版
// 字幕抽出関数 - ファイルサイズ制限対応版
async function extractSubtitles(projectDir: string, apiKey?: string): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    // APIキーを取得（引数 > 環境変数 > 保存済み設定）
    const openaiApiKey = apiKey || process.env.OPENAI_API_KEY || config.apiKey;
    if (!openaiApiKey) {
      throw new Error('OpenAI APIキーが必要です。--api-key オプション、.envファイル、またはOPENAI_API_KEY環境変数で指定してください。');
    }
    
    // 設定を更新
    config.apiKey = openaiApiKey;
    await updateConfig(config);
    
    console.log(`動画から字幕を抽出中: ${config.videoFile}`);
    
    // 一時的な音声ファイルのパス
    const tempAudio = join(projectDir, 'temp_audio.mp3');
    
    try {
      // FFmpegで動画から音声を抽出 - 低ビットレート設定 (64k)
      await new Promise<void>((resolve, reject) => {
        console.log('動画から音声を抽出中... (低ビットレート64kbpsで抽出)');
        const ffmpeg = spawn('ffmpeg', [
          '-i', config.videoFile,
          '-q:a', '0',
          '-map', 'a',
          '-b:a', '64k',  // 低ビットレート設定
          '-c:a', 'libmp3lame',
          tempAudio
        ]);
        
        let stderr = '';
        ffmpeg.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`FFmpegが終了コード ${code} で失敗しました: ${stderr}`));
          }
        });
      });
      
      // 抽出された音声ファイルのサイズをチェック
      const audioFile = Bun.file(tempAudio);
      const audioSize = await audioFile.size;
      const maxWhisperSize = 25 * 1024 * 1024; // 25MB
      
      console.log(`音声ファイルサイズ: ${(audioSize / (1024 * 1024)).toFixed(2)}MB`);
      
      // ファイルサイズが大きい場合は分割処理
      if (audioSize > maxWhisperSize) {
        console.log('音声ファイルが大きすぎるため、分割処理を行います...');
        await processSplitAudio(config.videoFile, config.srtFile, openaiApiKey, config.language);
      } else {
        // 通常処理 - 音声ファイルを読み込む
        console.log('Whisper APIで文字起こし中...');
        const audioBlob = await audioFile.arrayBuffer();
        
        // FormDataを作成
        const formData = new FormData();
        formData.append('file', new Blob([audioBlob]), 'audio.mp3');
        formData.append('model', 'whisper-1');
        formData.append('language', config.language);
        formData.append('response_format', 'srt');
        
        // Whisper APIを呼び出し
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`
          },
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Whisper API エラー: ${JSON.stringify(errorData)}`);
        }
        
        // レスポンスをSRTファイルとして保存
        const transcription = await response.text();
        await writeFile(config.srtFile, transcription, 'utf-8');
      }
      
      console.log(`字幕ファイルを生成しました: ${config.srtFile}`);
      console.log('次のステップ:');
      console.log(`1. 字幕を確認・編集: bun run index.ts edit-subtitles -p ${projectDir}`);
      console.log(`2. テーマを抽出: bun run index.ts extract-themes -p ${projectDir}`);
      
    } finally {
      // 一時ファイルを削除
      try {
        await Bun.write(tempAudio, ''); // ファイルを空にする
      } catch (e) {
        console.warn(`一時ファイル ${tempAudio} の削除に失敗しました`);
      }
    }
  } catch (error) {
    console.error(`字幕抽出中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// 分割処理による音声処理関数
async function processSplitAudio(
  videoPath: string, 
  outputSrtPath: string, 
  apiKey: string, 
  language: string,
  chunkDurationSec: number = 600 // デフォルト10分
): Promise<void> {
  try {
    // 動画の長さを取得
    const videoInfo = await getVideoDuration(videoPath);
    const videoDurationSec = videoInfo.durationSec;
    console.log(`動画の長さ: ${formatTime(videoDurationSec)} (${videoDurationSec}秒)`);
    
    // 処理するチャンクの数を計算
    const chunks = Math.ceil(videoDurationSec / chunkDurationSec);
    console.log(`${chunks}個の部分に分割して処理します (各${formatTime(chunkDurationSec)})`);
    
    // 各チャンクを処理
    const allTranscriptions: string[] = [];
    
    for (let i = 0; i < chunks; i++) {
      const startTime = i * chunkDurationSec;
      const endTime = Math.min((i + 1) * chunkDurationSec, videoDurationSec);
      const segmentDuration = endTime - startTime;
      
      console.log(`[${i+1}/${chunks}] ${formatTime(startTime)} ~ ${formatTime(endTime)} を処理中...`);
      
      // 一時的な音声ファイルのパス
      const tempChunkAudio = `tmp/temp_chunk_${i}.mp3`;
      
      try {
        // FFmpegでセグメントを抽出
        await new Promise<void>((resolve, reject) => {
          const ffmpeg = spawn('ffmpeg', [
            '-i', videoPath,
            '-ss', startTime.toString(),  // 開始時間
            '-t', segmentDuration.toString(),  // 継続時間
            '-q:a', '0',
            '-map', 'a',
            '-b:a', '48k',  // さらに低いビットレート
            '-c:a', 'libmp3lame',
            tempChunkAudio
          ]);
          
          let stderr = '';
          ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          
          ffmpeg.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`FFmpegが終了コード ${code} で失敗しました: ${stderr}`));
            }
          });
        });
        
        // 音声ファイルを読み込む
        const audioFile = Bun.file(tempChunkAudio);
        const audioSize = await audioFile.size;
        console.log(`セグメント音声ファイルサイズ: ${(audioSize / (1024 * 1024)).toFixed(2)}MB`);
        
        const audioBlob = await audioFile.arrayBuffer();
        
        // FormDataを作成
        const formData = new FormData();
        formData.append('file', new Blob([audioBlob]), 'audio.mp3');
        formData.append('model', 'whisper-1');
        formData.append('language', language);
        formData.append('response_format', 'srt');
        
        // Whisper APIを呼び出し
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`
          },
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`Whisper API エラー: ${JSON.stringify(errorData)}`);
        }
        
        // SRTテキストを取得して格納
        let transcription = await response.text();
        
        // 時間をオフセット調整
        transcription = adjustSrtTimestamps(transcription, startTime);
        
        allTranscriptions.push(transcription);
        
      } finally {
        // 一時ファイルを削除
        try {
          await Bun.write(tempChunkAudio, ''); // ファイルを空にする
        } catch (e) {
          console.warn(`一時ファイル ${tempChunkAudio} の削除に失敗しました`);
        }
      }
    }
    
    // 全ての字幕を結合して保存
    const combinedTranscription = combineSrtFiles(allTranscriptions);
    await writeFile(outputSrtPath, combinedTranscription, 'utf-8');
    
    console.log(`分割処理が完了し、結合された字幕ファイルを保存しました`);
    
  } catch (error) {
    throw new Error(`分割処理中にエラーが発生しました: ${(error as Error).message}`);
  }
}

// 時間をフォーマットする関数
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// 動画の長さを取得する関数
async function getVideoDuration(videoPath: string): Promise<{durationSec: number}> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath
    ]);
    
    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    let stderr = '';
    ffprobe.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code === 0) {
        const durationSec = parseFloat(output.trim());
        resolve({ durationSec });
      } else {
        reject(new Error(`FFprobeが終了コード ${code} で失敗しました: ${stderr}`));
      }
    });
  });
}

// SRTのタイムスタンプを調整する関数
function adjustSrtTimestamps(srtContent: string, offsetSeconds: number): string {
  const timeRegex = /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g;
  
  return srtContent.replace(timeRegex, (match, sh, sm, ss, sms, eh, em, es, ems) => {
    // 開始時間を調整
    let startTime = parseInt(sh) * 3600 + parseInt(sm) * 60 + parseInt(ss) + parseInt(sms) / 1000;
    startTime += offsetSeconds;
    
    // 終了時間を調整
    let endTime = parseInt(eh) * 3600 + parseInt(em) * 60 + parseInt(es) + parseInt(ems) / 1000;
    endTime += offsetSeconds;
    
    // 新しいフォーマットに変換
    const formatTimestamp = (time: number) => {
      const hours = Math.floor(time / 3600);
      const minutes = Math.floor((time % 3600) / 60);
      const seconds = Math.floor(time % 60);
      const milliseconds = Math.floor((time % 1) * 1000);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
    };
    
    return `${formatTimestamp(startTime)} --> ${formatTimestamp(endTime)}`;
  });
}

// 複数のSRTファイルを結合する関数
function combineSrtFiles(srtContents: string[]): string {
  let combinedContent = '';
  let subtitleIndex = 1;
  
  for (const content of srtContents) {
    // 各SRTファイルの内容を処理
    const lines = content.split('\n');
    let i = 0;
    
    while (i < lines.length) {
      // 空行または数字のみの行（インデックス）をスキップ
      if (lines[i].trim() === '' || /^\d+$/.test(lines[i].trim())) {
        i++;
        continue;
      }
      
      // タイムスタンプ行を探す
      if (/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(lines[i])) {
        const timestamp = lines[i];
        i++;
        
        // 字幕テキストを集める
        let subtitleText = '';
        while (i < lines.length && lines[i].trim() !== '' && !/^\d+$/.test(lines[i].trim()) && 
               !/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(lines[i])) {
          subtitleText += lines[i] + '\n';
          i++;
        }
        
        // 新しいインデックスで字幕エントリを追加
        combinedContent += `${subtitleIndex}\n${timestamp}\n${subtitleText}\n`;
        subtitleIndex++;
      } else {
        // 予期しない形式の行はスキップ
        i++;
      }
    }
  }
  
  return combinedContent.trim();
}

// 字幕ファイルをエディタで開く関数
async function openSubtitlesEditor(projectDir: string): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    if (!existsSync(config.srtFile)) {
      throw new Error(`字幕ファイルが見つかりません: ${config.srtFile}`);
    }
    
    console.log(`字幕ファイルをエディタで開きます: ${config.srtFile}`);
    await open(config.srtFile);
    
    console.log('字幕を確認・編集したら、次のステップに進みます:');
    console.log(`テーマを抽出: bun run index.ts extract-themes -p ${projectDir}`);
  } catch (error) {
    console.error(`字幕エディタを開くときにエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// テーマ抽出関数
async function extractThemes(
  projectDir: string, 
  apiKey?: string, 
  model?: string,
  provider?: string
): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    // APIキーを取得（引数 > 環境変数 > 保存済み設定）
    const providedProvider = provider || config.modelProvider || 'google';
    const providerEnvVar = providedProvider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY';
    const apiKeyEnvVar = process.env[providerEnvVar];
    
    const aiApiKey = apiKey || apiKeyEnvVar || config.apiKey;
    if (!aiApiKey) {
      throw new Error(`${providedProvider === 'google' ? 'Google' : 'OpenAI'} APIキーが必要です。--api-key オプション、.envファイル、または${providerEnvVar}環境変数で指定してください。`);
    }
    
    // モデルを設定
    const aiModel = model || config.model || (providedProvider === 'google' ? 'gemini-1.5-flash' : 'gpt-3.5-turbo');
    
    // 設定を更新
    config.apiKey = aiApiKey;
    config.model = aiModel;
    config.modelProvider = providedProvider;
    await updateConfig(config);
    
    if (!existsSync(config.srtFile)) {
      throw new Error(`字幕ファイルが見つかりません: ${config.srtFile}`);
    }
    
    // SRTファイルを読み込む
    const srtContent = await readFile(config.srtFile, 'utf-8');
    
    console.log(`字幕からテーマを抽出中... (プロバイダー: ${providedProvider}, モデル: ${aiModel})`);
    
    // SRTファイルの大きさをチェック
    const estimatedTokens = estimateSrtTokens(srtContent);
    const maxTokens = getModelMaxTokens(aiModel, providedProvider);
    const promptOverhead = 500; // システムプロンプトとユーザープロンプトの追加トークン数（概算）
    
    console.log(`字幕の推定トークン数: 約${estimatedTokens}トークン`);
    console.log(`${aiModel}の最大トークン数: ${maxTokens}トークン`);
    
    let themes: ThemeEntry[] = [];
    
    if (estimatedTokens + promptOverhead > maxTokens) {
      // 字幕が大きすぎる場合は分割処理
      console.log(`字幕が長いため、分割処理を行います...`);
      themes = await processLargeSrt(srtContent, aiApiKey, aiModel, providedProvider);
    } else {
      // 通常処理
      console.log(`通常の処理で字幕を分析します...`);
      try {
        themes = await extractThemesWithAI(srtContent, aiApiKey, aiModel, providedProvider);
      } catch (error) {
        // 強制分割エラーをチェック
        if ((error as Error).message === 'FORCE_SPLIT') {
          console.log('APIがコンテキスト長超過を報告したため、分割処理に切り替えます...');
          themes = await processLargeSrt(srtContent, aiApiKey, aiModel, providedProvider);
        } else {
          throw error;
        }
      }
    }
    
    // テーマをJSONファイルに保存
    await writeFile(config.themesFile, JSON.stringify(themes, null, 2), 'utf-8');
    
    console.log(`テーマを抽出し保存しました: ${config.themesFile}`);
    console.log('次のステップ:');
    console.log(`1. テーマを確認・編集: bun run index.ts edit-themes -p ${projectDir}`);
    console.log(`2. 最終動画を作成: bun run index.ts create-video -p ${projectDir}`);
  } catch (error) {
    console.error(`テーマ抽出中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// モデルごとの最大トークン数を取得
function getModelMaxTokens(model: string, provider: string = 'openai'): number {
  const openaiModelLimits: {[key: string]: number} = {
    'gpt-3.5-turbo': 16385,
    'gpt-3.5-turbo-16k': 16385,
    'gpt-4': 8192,
    'gpt-4-32k': 32768,
    'gpt-4-turbo': 128000,
  };

  const googleModelLimits: {[key: string]: number} = {
    'gemini-pro': 32768,
    'gemini-1.5-flash': 1048576,
    'gemini-1.5-pro': 1048576,
  };
  
  if (provider === 'google') {
    return googleModelLimits[model] || 32768; // デフォルト値
  }
  
  return openaiModelLimits[model] || 16385; // デフォルト値
}

// SRTファイルのトークン数を推定する関数
function estimateSrtTokens(srtContent: string): number {
  // 英語の場合、単語数の約1.3倍がトークン数の目安
  // 日本語などの場合はもっと多くなるため、係数を大きめに設定
  const tokenMultiplier = 8.0;  // 日本語のために係数を大幅に増加
  
  // 空白で分割して単語数を概算
  const wordCount = srtContent.split(/\s+/).length;
  // 文字数も加味する（日本語の場合特に重要）
  const charCount = srtContent.length;
  
  // 単語数と文字数の両方を考慮した推定
  return Math.ceil(Math.max(wordCount * tokenMultiplier, charCount / 3));
}

// 大きなSRTファイルを分割処理する関数
async function processLargeSrt(
  srtContent: string, 
  apiKey: string, 
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  // SRTをパースして字幕エントリのリストを取得
  const subtitles = parseSrt(srtContent);
  
  // モデルのトークン数制限に基づいてチャンクサイズを設定
  const maxTokens = getModelMaxTokens(model, provider);
  const promptOverhead = 500;
  const maxContentTokens = maxTokens - promptOverhead;
  
  // 1チャンクあたりの最大字幕数を計算（安全マージンを持たせる）
  const averageSubtitleLength = srtContent.length / subtitles.length;
  const averageSubtitleTokens = averageSubtitleLength / 4; // 文字数の約1/4がトークン数と仮定
  const subtitlesPerChunk = Math.floor(maxContentTokens / averageSubtitleTokens / 4); // より小さく分割（4で割る）
  
  const numChunks = Math.ceil(subtitles.length / subtitlesPerChunk);
  console.log(`字幕を約${numChunks}個のチャンクに分割して処理します (1チャンクあたり約${subtitlesPerChunk}行)`);
  
  // 字幕を適切なチャンクに分割
  const chunks: string[] = [];
  for (let i = 0; i < subtitles.length; i += subtitlesPerChunk) {
    const chunkSubtitles = subtitles.slice(i, i + subtitlesPerChunk);
    chunks.push(formatSubtitlesToSrt(chunkSubtitles));
  }
  
  // 各チャンクを処理
  const allThemes: ThemeEntry[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`チャンク ${i+1}/${chunks.length} を処理中...`);
    try {
      const chunkThemes = await extractThemesWithAI(chunks[i], apiKey, model, provider);
      allThemes.push(...chunkThemes);
    } catch (error) {
      // エラーの種類を確認
      if ((error as Error).message === 'FORCE_SPLIT' && chunks[i].length > 1000) {
        // さらに小さく分割する必要がある場合
        console.log('このチャンクをさらに小さく分割します...');
        // 再帰的に処理する
        const subChunks = await splitAndProcessChunk(chunks[i], apiKey, model, provider);
        allThemes.push(...subChunks);
      } else {
        // その他のエラーは再スロー
        throw error;
      }
    }
  }
  
  // 重複するテーマをマージ
  return mergeOverlappingThemes(allThemes);
}

// 個別のチャンクをさらに小さく分割して処理する関数
async function splitAndProcessChunk(
  chunk: string,
  apiKey: string,
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  // SRTをパースして字幕エントリのリストを取得
  const subtitles = parseSrt(chunk);
  
  // さらに小さいチャンクに分割（元のサイズの1/4程度）
  const subChunkSize = Math.max(5, Math.ceil(subtitles.length / 4));
  
  console.log(`サブチャンク処理: ${subtitles.length}行を${Math.ceil(subtitles.length / subChunkSize)}個に分割`);
  
  const subChunks: string[] = [];
  for (let i = 0; i < subtitles.length; i += subChunkSize) {
    const subChunkSubtitles = subtitles.slice(i, i + subChunkSize);
    subChunks.push(formatSubtitlesToSrt(subChunkSubtitles));
  }
  
  // 各サブチャンクを処理
  const results: ThemeEntry[] = [];
  
  for (let i = 0; i < subChunks.length; i++) {
    console.log(`サブチャンク ${i+1}/${subChunks.length} を処理中...`);
    try {
      const subThemes = await extractThemesWithAI(subChunks[i], apiKey, model, provider);
      results.push(...subThemes);
    } catch (error) {
      // 極小チャンクでもエラーが出る場合はスキップ
      if ((error as Error).message === 'FORCE_SPLIT') {
        console.warn(`サブチャンク ${i+1} は処理できませんでした - スキップします`);
        continue;
      }
      throw error;
    }
  }
  
  return results;
}

// SRTを字幕エントリに分解する関数
function parseSrt(srtContent: string): {id: number, start: string, end: string, text: string}[] {
  const lines = srtContent.split('\n');
  const subtitles: {id: number, start: string, end: string, text: string}[] = [];
  
  let i = 0;
  while (i < lines.length) {
    // 空行をスキップ
    if (lines[i].trim() === '') {
      i++;
      continue;
    }
    
    // 字幕IDを取得
    const id = parseInt(lines[i]);
    if (isNaN(id)) {
      i++;
      continue;
    }
    i++;
    
    // タイムスタンプを取得
    if (i >= lines.length) break;
    const timestampMatch = lines[i].match(/(\d{2}:\d{2}:\d{2}),\d{3} --> (\d{2}:\d{2}:\d{2}),\d{3}/);
    if (!timestampMatch) {
      i++;
      continue;
    }
    
    const start = timestampMatch[1];
    const end = timestampMatch[2];
    i++;
    
    // 字幕テキストを取得
    let text = '';
    while (i < lines.length && lines[i].trim() !== '' && !(/^\d+$/.test(lines[i].trim()))) {
      text += lines[i] + '\n';
      i++;
    }
    
    subtitles.push({
      id,
      start,
      end,
      text: text.trim()
    });
  }
  
  return subtitles;
}

// 字幕エントリをSRT形式に整形する関数
function formatSubtitlesToSrt(subtitles: {id: number, start: string, end: string, text: string}[]): string {
  return subtitles.map(sub => {
    return `${sub.id}\n${sub.start} --> ${sub.end}\n${sub.text}\n`;
  }).join('\n');
}

// 重複するテーマをマージする関数
function mergeOverlappingThemes(themes: ThemeEntry[]): ThemeEntry[] {
  // まず時間順にソート
  themes.sort((a, b) => {
    return timeToSeconds(a.start) - timeToSeconds(b.start);
  });
  
  const mergedThemes: ThemeEntry[] = [];
  let currentTheme: ThemeEntry | null = null;
  
  for (const theme of themes) {
    if (!currentTheme) {
      currentTheme = { ...theme };
      continue;
    }
    
    const currentEndTime = timeToSeconds(currentTheme.end);
    const nextStartTime = timeToSeconds(theme.start);
    
    // 類似したテーマかどうかチェック
    const similarThemes = areSimilarThemes(currentTheme.theme, theme.theme);
    
    // 時間的に近いか重複しており、テーマが類似している場合はマージ
    if ((nextStartTime - currentEndTime < 10 || nextStartTime <= currentEndTime) && similarThemes) {
      // 終了時間を更新（遅い方を採用）
      if (timeToSeconds(theme.end) > timeToSeconds(currentTheme.end)) {
        currentTheme.end = theme.end;
      }
    } else {
      // そうでない場合は現在のテーマを追加し、新しいテーマを開始
      mergedThemes.push(currentTheme);
      currentTheme = { ...theme };
    }
  }
  
  // 最後のテーマを追加
  if (currentTheme) {
    mergedThemes.push(currentTheme);
  }
  
  return mergedThemes;
}

// 2つのテーマが類似しているかどうかを判定する関数
function areSimilarThemes(theme1: string, theme2: string): boolean {
  // 文字列を前処理: 小文字に変換し、特殊文字を削除
  const normalizeTheme = (theme: string) => {
    return theme.toLowerCase()
      .replace(/について|に関して|とは|の方法/g, '')  // 日本語の一般的な表現を削除
      .replace(/[.,;:!?'"()]/g, '')  // 句読点を削除
      .trim();
  };
  
  const normalized1 = normalizeTheme(theme1);
  const normalized2 = normalizeTheme(theme2);
  
  // 単語の類似度を計算
  const words1 = normalized1.split(/\s+/);
  const words2 = normalized2.split(/\s+/);
  
  // どちらかが空の場合は似ていないと判断
  if (words1.length === 0 || words2.length === 0) {
    return false;
  }
  
  // 共通の単語をカウント
  const commonWords = words1.filter(word => words2.includes(word));
  
  // 共通単語率を計算（両方のテーマの平均単語数に対する割合）
  const similarityRatio = (2 * commonWords.length) / (words1.length + words2.length);
  
  // 短い単語数の場合は完全一致を要求し、長い場合は部分一致も許容
  const minWordCount = Math.min(words1.length, words2.length);
  const similarityThreshold = minWordCount <= 3 ? 0.7 : 0.5;
  
  return similarityRatio >= similarityThreshold;
}

// プロバイダーに応じて適切なAI APIを呼び出す関数
async function extractThemesWithAI(
  srtContent: string, 
  apiKey: string, 
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  if (provider === 'google') {
    return extractThemesWithGemini(srtContent, apiKey, model);
  } else {
    return extractThemesWithOpenAI(srtContent, apiKey, model);
  }
}

// OpenAI APIを使用してテーマを抽出する関数
async function extractThemesWithOpenAI(
  srtContent: string, 
  apiKey: string, 
  model: string
): Promise<ThemeEntry[]> {
  const systemPrompt = `
あなたは動画内の話題やテーマを正確に抽出する専門家です。
SRT字幕ファイルを分析して、動画内で話されている主要なテーマとその時間範囲を特定してください。
特に「〜について」「〜とは」「〜の方法」などの表現や、話題の転換点に注目してください。
結果は指定されたJSON形式でのみ出力し、追加の説明は不要です。

字幕が部分的なものである場合も、その部分だけでテーマを抽出してください。
`;

  const userPrompt = `
以下のSRT字幕を分析して、動画内の主要なテーマとその時間範囲を特定してください。
1つのセグメントに複数のトピックが含まれる場合は、複数のエントリに分けてください。

結果は以下のJSON形式で出力してください：

[
  {"start": "00:01:15,500", "end": "00:03:45,800", "theme": "AIの歴史について"},
  {"start": "00:03:46,000", "end": "00:07:30,200", "theme": "機械学習の応用について"}
]

他の解説は不要です。JSONのみを出力してください。

字幕ファイル：
${srtContent}
`;

  try {
    // OpenAI APIを呼び出し
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API エラー: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    let content = data.choices[0].message.content;
    
    // JSONの部分だけを抽出
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      content = content.substring(jsonStart, jsonEnd);
    }
    
    // JSONをパース
    try {
      return JSON.parse(content) as ThemeEntry[];
    } catch (error) {
      console.warn(`テーマJSONのパースに失敗: ${(error as Error).message}`);
      console.warn(`受信したJSON: ${content}`);
      
      // JSONの修正を試みる
      const cleanedJson = cleanJsonString(content);
      try {
        return JSON.parse(cleanedJson) as ThemeEntry[];
      } catch (secondError) {
        throw new Error(`JSON修正後もパースに失敗: ${(secondError as Error).message}`);
      }
    }
  } catch (error) {
    if ((error as Error).message.includes('context_length_exceeded') || 
        (error as Error).message.includes('maximum context length')) {
      console.error('テキストがモデルの最大コンテキスト長を超えています。自動的に分割処理を行います。');
      throw new Error('FORCE_SPLIT');
    }
    throw error;
  }
}

// JSON文字列を修正する関数
function cleanJsonString(jsonStr: string): string {
  // 末尾のカンマを修正
  let cleaned = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
  
  // シングルクォートをダブルクォートに変換
  cleaned = cleaned.replace(/'/g, '"');
  
  // JSONキーをダブルクォートで囲む
  cleaned = cleaned.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
  return cleaned;
}

// テーマJSONファイルをエディタで開く関数
async function openThemesEditor(projectDir: string): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    if (!existsSync(config.themesFile)) {
      throw new Error(`テーマJSONファイルが見つかりません: ${config.themesFile}`);
    }
    
    console.log(`テーマJSONファイルをエディタで開きます: ${config.themesFile}`);
    await open(config.themesFile);
    
    console.log('テーマを確認・編集したら、次のステップに進みます:');
    console.log(`最終動画を作成: bun run index.ts create-video -p ${projectDir}`);
  } catch (error) {
    console.error(`テーマエディタを開くときにエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// SRTの時間文字列を秒数に変換する関数
function timeToSeconds(timeStr: string): number {
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  const milliseconds = parseInt(match[4]);
  
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

// 最終ビデオを作成する関数
async function createFinalVideo(
  projectDir: string, 
  fontSize: number, 
  bgOpacity: number,
  options: {fadeTime?: number, bgStyle?: string} = {}
): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    if (!existsSync(config.themesFile)) {
      throw new Error(`テーマJSONファイルが見つかりません: ${config.themesFile}`);
    }
    
    if (!existsSync(config.videoFile)) {
      throw new Error(`入力動画ファイルが見つかりません: ${config.videoFile}`);
    }
    
    // テーマJSONを読み込む
    const themesContent = await readFile(config.themesFile, 'utf-8');
    const themes = JSON.parse(themesContent) as ThemeEntry[];
    
    // 設定を更新
    config.fontSize = fontSize;
    config.bgOpacity = bgOpacity;
    await updateConfig(config);

    // 出力ファイルが既に存在する場合の処理
    if (existsSync(config.outputFile)) {
      console.log(`出力ファイルが既に存在します: ${config.outputFile}`);
      
      // 上書きか別名保存か選択できるようにする
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
      const extension = config.outputFile.substring(config.outputFile.lastIndexOf('.'));
      const fileNameWithoutExt = config.outputFile.substring(0, config.outputFile.lastIndexOf('.'));
      const newOutputFile = `${fileNameWithoutExt}_${timestamp}${extension}`;
      
      console.log(`新しい出力ファイル名: ${newOutputFile}`);
      config.outputFile = newOutputFile;
      await updateConfig(config);
    }

    // 日本語フォントを探す
    const fontPath = await findJapaneseFont();
    console.log(`使用するフォント: ${fontPath}`);
    
    console.log(`動画にテーマをオーバーレイ中: ${config.videoFile} -> ${config.outputFile}`);
    
    // 中間ファイルのパス
    const subtitleFile = join(projectDir, 'themes.ass');
    
    // ASSファイルを生成
    await generateAssSubtitle(themes, subtitleFile, fontSize, bgOpacity, options.fadeTime || 0.5, fontPath);
    console.log(`字幕ファイルを生成しました: ${subtitleFile}`);
    
    // FFmpegを実行
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', config.videoFile,
        '-vf', `ass=${subtitleFile}`,
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '22',
        '-y', // 既存のファイルを上書き
        config.outputFile
      ]);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // 進捗表示をコンソールに出力
        process.stderr.write('.');
      });
      
      ffmpeg.on('close', (code) => {
        process.stderr.write('\n');
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpegが終了コード ${code} で失敗しました: ${stderr}`));
        }
      });
    });
    
    console.log(`テーマオーバーレイ付き動画を作成しました: ${config.outputFile}`);
  } catch (error) {
    console.error(`動画作成中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ASSサブタイトルファイルを生成する関数
async function generateAssSubtitle(
  themes: ThemeEntry[],
  outputPath: string,
  fontSize: number,
  bgOpacity: number,
  fadeTime: number,
  fontPath: string
): Promise<void> {
  // ASSファイルのヘッダー
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontPath ? basename(fontPath) : 'Arial'},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H${Math.round(bgOpacity*255).toString(16).padStart(2, '0')}000000,0,0,0,0,100,100,0,0,1,2,0,7,20,20,15,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // イベント行の生成
  const events = themes.map(theme => {
    const startTime = convertSrtTimeToAss(theme.start);
    const endTime = convertSrtTimeToAss(theme.end);
    
    // テキスト内の改行を扱う
    const text = theme.theme.replace(/\n/g, '\\N');
    
    // フェード効果を直接テキストに埋め込む（ASSの正しい形式）
    const fadeMs = Math.round(fadeTime * 1000);
    const textWithFade = `{\\fad(${fadeMs},${fadeMs})}${text}`;
    
    // 単一のイベントとしてフェード効果を含める
    return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${textWithFade}`;
  }).join('\n');

  // ASSファイルを書き込む
  await writeFile(outputPath, header + events, 'utf-8');
}

// SRTの時間形式（00:00:00,000）をASS形式（0:00:00.00）に変換
function convertSrtTimeToAss(srtTime: string): string {
  const match = srtTime.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return '0:00:00.00';
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]).toString().padStart(2, '0');
  const seconds = parseInt(match[3]).toString().padStart(2, '0');
  const milliseconds = parseInt(match[4].substring(0, 2)).toString().padStart(2, '0'); // ASSは2桁のみ
  
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// 秒数をASS時間形式（0:00:00.00）に変換
function convertSecondsToAss(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
  
  return `${hours}:${minutes}:${secs}.${ms}`;
}

// 日本語フォントを探す関数
async function findJapaneseFont(): Promise<string> {
  const platform = process.platform;
  
  // macOS用フォントパス
  const macFonts = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/Supplemental/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/System/Library/Fonts/ヒラギノ丸ゴ ProN W4.ttc',
    '/Library/Fonts/Arial Unicode.ttf'
  ];
  
  // Linux用フォントパス
  const linuxFonts = [
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/google-noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/ipafont-gothic/ipag.ttf'
  ];
  
  // Windows用フォントパス
  const windowsFonts = [
    'C:\\Windows\\Fonts\\msgothic.ttc',
    'C:\\Windows\\Fonts\\meiryo.ttc',
    'C:\\Windows\\Fonts\\YuGothR.ttc',
    'C:\\Windows\\Fonts\\msmincho.ttc'
  ];
  
  let fontCandidates: string[] = [];
  
  // OSに応じたフォント候補を選択
  if (platform === 'darwin') {
    fontCandidates = macFonts;
  } else if (platform === 'linux') {
    fontCandidates = linuxFonts;
  } else if (platform === 'win32') {
    fontCandidates = windowsFonts;
  }
  
  // 存在するフォントを探す
  for (const fontPath of fontCandidates) {
    if (existsSync(fontPath)) {
      return fontPath;
    }
  }
  
  // デフォルトフォント (フォントが見つからない場合はFFmpegのデフォルトを使用)
  console.warn('⚠️ 日本語フォントが見つかりませんでした。文字化けする可能性があります。');
  return '';
}

// すべてのステップを実行する関数
async function runAllSteps(
  videoPath: string,
  projectDir: string,
  language: string,
  apiKey: string | undefined,
  model: string,
  provider: string,
  fontSize: number,
  bgOpacity: number
): Promise<void> {
  try {
    // APIキーを環境変数から取得
    const apiKeyEnvVar = provider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY';
    apiKey = apiKey || process.env[apiKeyEnvVar];
    
    if (!apiKey) {
      throw new Error(`${provider === 'google' ? 'Google' : 'OpenAI'} APIキーが必要です。--api-key オプション、.envファイル、または${apiKeyEnvVar}環境変数で指定してください。`);
    }
    
    // ステップ1: プロジェクト初期化
    console.log('--- ステップ 1: プロジェクト初期化 ---');
    await initProject(videoPath, projectDir, language);
    
    // ステップ2: 字幕抽出
    console.log('\n--- ステップ 2: 字幕抽出 ---');
    await extractSubtitles(projectDir, apiKey);
    
    // ステップ3: 字幕確認（手動）
    console.log('\n--- ステップ 3: 字幕確認 ---');
    await openSubtitlesEditor(projectDir);
    
    // ユーザーの確認を待つ
    await waitForUserConfirmation('字幕の確認・編集が完了したら、Enterキーを押してください...');
    
    // ステップ4: テーマ抽出
    console.log('\n--- ステップ 4: テーマ抽出 ---');
    await extractThemes(projectDir, apiKey, model, provider);
    
    // ステップ5: テーマ確認（手動）
    console.log('\n--- ステップ 5: テーマ確認 ---');
    await openThemesEditor(projectDir);
    
    // ユーザーの確認を待つ
    await waitForUserConfirmation('テーマの確認・編集が完了したら、Enterキーを押してください...');
    
    // ステップ6: 最終動画作成
    console.log('\n--- ステップ 6: 最終動画作成 ---');
    await createFinalVideo(projectDir, fontSize, bgOpacity);
    
    console.log('\nすべてのステップが完了しました！');
    
    // 設定を読み込んで出力ファイルのパスを取得
    const config = await loadConfig(projectDir);
    console.log(`最終動画: ${config.outputFile}`);
  } catch (error) {
    console.error(`ワークフロー実行中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// ユーザーの確認を待つ関数
async function waitForUserConfirmation(message: string): Promise<void> {
  console.log(message);
  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });
}

// Gemini APIを使用してテーマを抽出する関数
async function extractThemesWithGemini(
  srtContent: string, 
  apiKey: string, 
  model: string
): Promise<ThemeEntry[]> {
  const prompt = `
あなたは動画内の話題やテーマを正確に抽出する専門家です。
SRT字幕ファイルを分析して、動画内で話されている主要なテーマとその時間範囲を特定してください。
特に「〜について」「〜とは」「〜の方法」などの表現や、話題の転換点に注目してください。
結果は指定されたJSON形式でのみ出力し、追加の説明は不要です。

字幕が部分的なものである場合も、その部分だけでテーマを抽出してください。

以下のSRT字幕を分析して、動画内の主要なテーマとその時間範囲を特定してください。
1つのセグメントに複数のトピックが含まれる場合は、複数のエントリに分けてください。

結果は以下のJSON形式で出力してください：

[
  {"start": "00:01:15,500", "end": "00:03:45,800", "theme": "AIの歴史について"},
  {"start": "00:03:46,000", "end": "00:07:30,200", "theme": "機械学習の応用について"}
]

他の解説は不要です。JSONのみを出力してください。

字幕ファイル：
${srtContent}
`;

  try {
    // Gemini APIを呼び出し
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google AI API エラー: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    
    // Gemini API のレスポンス形式から内容を抽出
    let content = '';
    try {
      content = data.candidates[0].content.parts[0].text;
    } catch (error) {
      throw new Error(`Gemini APIからの応答解析に失敗しました: ${(error as Error).message}`);
    }
    
    // JSONの部分だけを抽出
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      content = content.substring(jsonStart, jsonEnd);
    }
    
    // JSONをパース
    try {
      return JSON.parse(content) as ThemeEntry[];
    } catch (error) {
      console.warn(`テーマJSONのパースに失敗: ${(error as Error).message}`);
      console.warn(`受信したJSON: ${content}`);
      
      // JSONの修正を試みる
      const cleanedJson = cleanJsonString(content);
      try {
        return JSON.parse(cleanedJson) as ThemeEntry[];
      } catch (secondError) {
        throw new Error(`JSON修正後もパースに失敗: ${(secondError as Error).message}`);
      }
    }
  } catch (error) {
    if ((error as Error).message.includes('Invalid model') || 
        (error as Error).message.includes('Quota exceeded')) {
      console.error(`Gemini API エラー: ${(error as Error).message}`);
    }
    
    if ((error as Error).message.includes('content too long') || 
        (error as Error).message.includes('exceeds maximum context length')) {
      console.error('テキストがモデルの最大コンテキスト長を超えています。自動的に分割処理を行います。');
      throw new Error('FORCE_SPLIT');
    }
    throw error;
  }
}