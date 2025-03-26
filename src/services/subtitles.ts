import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import open from 'open';
import { loadConfig, updateConfig, cleanupDirectory } from '../utils/file';
import { getVideoDuration } from '../utils/ffmpeg';
import { formatTime } from '../utils/format';
import { adjustSrtTimestamps, combineSrtFiles } from '../utils/srt';

// 字幕抽出関数 - ファイルサイズ制限対応版
export async function extractSubtitles(projectDir: string, apiKey?: string): Promise<void> {
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
      console.log(`1. 字幕を確認・編集: bun run edit-subtitles -p ${projectDir}`);
      console.log(`2. テーマを抽出: bun run extract-themes -p ${projectDir}`);
      
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
export async function processSplitAudio(
  videoPath: string, 
  outputSrtPath: string, 
  apiKey: string, 
  language: string,
  chunkDurationSec: number = 600 // デフォルト10分
): Promise<void> {
  try {
    // tmp ディレクトリをクリーンアップ
    const tmpDir = join(dirname(outputSrtPath), 'tmp');
    
    // tmp ディレクトリが存在しない場合は作成
    if (!existsSync(tmpDir)) {
      await import('fs/promises').then(fs => fs.mkdir(tmpDir, { recursive: true }));
      console.log(`一時ディレクトリを作成しました: ${tmpDir}`);
    } else {
      // 既存の tmp ディレクトリ内のファイルをクリーンアップ
      console.log(`一時ディレクトリをクリーンアップしています: ${tmpDir}`);
      await cleanupDirectory(tmpDir);
    }
    
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
      const tempChunkAudio = join(tmpDir, `temp_chunk_${i}.mp3`);
      
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

// 字幕ファイルをエディタで開く関数
export async function openSubtitlesEditor(projectDir: string): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    if (!existsSync(config.srtFile)) {
      throw new Error(`字幕ファイルが見つかりません: ${config.srtFile}`);
    }
    
    console.log(`字幕ファイルをエディタで開きます: ${config.srtFile}`);
    await open(config.srtFile);
    
    console.log('字幕を確認・編集したら、次のステップに進みます:');
    console.log(`テーマを抽出: bun run extract-themes -p ${projectDir}`);
  } catch (error) {
    console.error(`字幕エディタを開くときにエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
} 