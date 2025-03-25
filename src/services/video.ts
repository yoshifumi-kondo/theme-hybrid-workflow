import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import type { ThemeEntry } from '../types';
import { loadConfig, updateConfig } from '../utils/file';
import { findJapaneseFont } from '../utils/ffmpeg';
import { convertSrtTimeToAss, convertSecondsToAss } from '../utils/format';
import { getVideoDuration } from '../utils/ffmpeg';

// 最終ビデオを作成する関数
export async function createFinalVideo(
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
export async function generateAssSubtitle(
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

// サイレントカット処理関数
export async function processSilentCut(
  projectDir: string,
  threshold: number = -30,
  minSilenceDuration: number = 0.5,
  padding: number = 0.05,
  minSegmentDuration: number = 0.3,
  mode: string = 'silent'
): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    const originalVideo = config.videoFile;
    
    // カット済み動画の出力パス
    const fileExt = originalVideo.substring(originalVideo.lastIndexOf('.'));
    const fileNameWithoutExt = originalVideo.substring(0, originalVideo.lastIndexOf('.'));
    const processedVideo = `${fileNameWithoutExt}_cut${fileExt}`;
    
    console.log(`無音検出処理を開始します...`);
    console.log(`無音判定: ${threshold}dB以下の音が${minSilenceDuration}秒以上続く部分`);
    console.log(`カットモード: ${mode === 'silent' ? 'サイレントカット（無音部分を削除）' : 'ジャンプカット（動きの少ない部分を削除）'}`);
    
    // 一時ファイルパス
    const silenceInfoFile = join(projectDir, 'silence_info.txt');
    
    // ステップ1: 無音部分の検出
    await detectSilence(originalVideo, silenceInfoFile, threshold, minSilenceDuration);
    
    // ステップ2: 無音情報の解析とカット処理
    if (mode === 'silent') {
      await cutSilentParts(originalVideo, processedVideo, silenceInfoFile, padding, minSegmentDuration);
    } else {
      await performJumpCut(originalVideo, processedVideo, silenceInfoFile, padding, minSegmentDuration);
    }
    
    // 設定を更新して処理済み動画を使用
    const oldVideoPath = config.videoFile;
    config.videoFile = processedVideo;
    await updateConfig(config);
    
    console.log(`カット処理が完了しました！`);
    console.log(`元の動画: ${oldVideoPath}`);
    console.log(`処理済み動画: ${processedVideo}`);
    
    // 一時ファイルを削除
    await Bun.write(silenceInfoFile, ''); // ファイルを空にする
    
    console.log('次のステップ:');
    console.log(`字幕を抽出: bun run index.ts extract-subtitles -p ${projectDir}`);
  } catch (error) {
    console.error(`サイレントカット処理中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// 無音部分を検出する関数
async function detectSilence(
  videoPath: string,
  outputInfoFile: string,
  threshold: number,
  minSilenceDuration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('無音部分を検出中...');
    
    // FFmpegのsilencedetectフィルターを使用
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-af', `silencedetect=noise=${threshold}dB:d=${minSilenceDuration}`,
      '-f', 'null',
      '-'
    ]);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on('close', async (code) => {
      if (code === 0) {
        // silencedetectの出力を解析して保存
        const silenceInfo = parseSilenceDetectOutput(stderr);
        await writeFile(outputInfoFile, JSON.stringify(silenceInfo, null, 2), 'utf-8');
        resolve();
      } else {
        reject(new Error(`無音検出に失敗しました: ${stderr}`));
      }
    });
  });
}

// silencedetectの出力を解析する関数
function parseSilenceDetectOutput(output: string): {start: number, end: number, duration: number}[] {
  const silences: {start: number, end: number, duration: number}[] = [];
  
  // 無音開始と終了の正規表現
  const startRegex = /silence_start: (\d+\.?\d*)/g;
  const endRegex = /silence_end: (\d+\.?\d*) \| silence_duration: (\d+\.?\d*)/g;
  
  let match;
  const starts: number[] = [];
  
  // 無音開始時間を取得
  while ((match = startRegex.exec(output)) !== null) {
    starts.push(parseFloat(match[1]));
  }
  
  // 無音終了時間とデュレーションを取得
  let i = 0;
  while ((match = endRegex.exec(output)) !== null) {
    if (i < starts.length) {
      silences.push({
        start: starts[i],
        end: parseFloat(match[1]),
        duration: parseFloat(match[2])
      });
      i++;
    }
  }
  
  return silences;
}

// サイレントカット（無音部分を削除）を行う関数
async function cutSilentParts(
  inputVideo: string,
  outputVideo: string,
  silenceInfoFile: string,
  padding: number,
  minSegmentDuration: number
): Promise<void> {
  // 無音情報の読み込み
  const silenceInfoContent = await readFile(silenceInfoFile, 'utf-8');
  const silences = JSON.parse(silenceInfoContent) as {start: number, end: number, duration: number}[];
  
  // 動画の長さを取得
  const videoInfo = await getVideoDuration(inputVideo);
  const videoDuration = videoInfo.durationSec;
  
  // 維持するセグメントのリスト作成
  const segments: {start: number, end: number}[] = [];
  let lastEnd = 0;
  
  console.log(`${silences.length}個の無音部分を検出しました`);
  
  for (const silence of silences) {
    // パディングを考慮した無音の開始・終了時間
    const silenceStart = Math.max(0, silence.start - padding);
    const silenceEnd = Math.min(videoDuration, silence.end + padding);
    
    // 前のセグメントの終わりから無音の開始までのセグメントを追加
    if (silenceStart - lastEnd >= minSegmentDuration) {
      segments.push({
        start: lastEnd,
        end: silenceStart
      });
    }
    
    lastEnd = silenceEnd;
  }
  
  // 最後のセグメント
  if (videoDuration - lastEnd >= minSegmentDuration) {
    segments.push({
      start: lastEnd,
      end: videoDuration
    });
  }
  
  console.log(`${segments.length}個のセグメントを維持します`);
  
  // フィルターコンプレックスの構築
  const filterParts: string[] = [];
  const streamRefs: string[] = [];
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    filterParts.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${i}]`);
    filterParts.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${i}]`);
    streamRefs.push(`[v${i}][a${i}]`);
  }
  
  // セグメントの連結
  filterParts.push(`${streamRefs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`);
  
  // FFmpegコマンド実行
  return new Promise((resolve, reject) => {
    console.log('無音部分をカットして動画を生成中...');
    
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputVideo,
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-preset', 'medium',
      '-y',
      outputVideo
    ]);
    
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write('.');
    });
    
    ffmpeg.on('close', (code) => {
      process.stderr.write('\n');
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`無音カット処理に失敗しました: ${stderr}`));
      }
    });
  });
}

// ジャンプカット（動きの少ない部分も削除）を行う関数
async function performJumpCut(
  inputVideo: string,
  outputVideo: string,
  silenceInfoFile: string,
  padding: number,
  minSegmentDuration: number
): Promise<void> {
  // 無音情報の読み込み
  const silenceInfoContent = await readFile(silenceInfoFile, 'utf-8');
  const silences = JSON.parse(silenceInfoContent) as {start: number, end: number, duration: number}[];
  
  // ジャンプカット用の一時フォルダ
  const tmpDir = join(dirname(outputVideo), 'tmp_jumpcut');
  if (!existsSync(tmpDir)) {
    await mkdir(tmpDir, { recursive: true });
  }
  
  try {
    // 動画フレームの変化率を検出
    console.log('動画内の動きを分析中...');
    const sceneInfoFile = join(tmpDir, 'scene_info.txt');
    
    await new Promise<void>((resolve, reject) => {
      // FFmpegのscene detectionを使用して動きの変化を検出
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputVideo,
        '-filter:v', 'select=\'gt(scene,0.1)\'',
        '-vsync', 'vfr',
        '-f', 'null',
        '-'
      ]);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          // シーン検出情報を保存
          writeFile(sceneInfoFile, stderr, 'utf-8')
            .then(() => resolve())
            .catch(err => reject(err));
        } else {
          reject(new Error(`シーン検出に失敗しました: ${stderr}`));
        }
      });
    });
    
    // シーン検出と無音情報を組み合わせて、カットするセグメントを決定
    const combinedSegments = await combineSceneAndSilenceInfo(sceneInfoFile, silenceInfoFile, inputVideo, padding, minSegmentDuration);
    
    // フィルターコンプレックスの構築
    const filterParts: string[] = [];
    const streamRefs: string[] = [];
    
    for (let i = 0; i < combinedSegments.length; i++) {
      const segment = combinedSegments[i];
      filterParts.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${i}]`);
      filterParts.push(`[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${i}]`);
      streamRefs.push(`[v${i}][a${i}]`);
    }
    
    // セグメントの連結
    filterParts.push(`${streamRefs.join('')}concat=n=${combinedSegments.length}:v=1:a=1[outv][outa]`);
    
    // FFmpegコマンド実行
    return new Promise((resolve, reject) => {
      console.log('ジャンプカット処理で動画を生成中...');
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputVideo,
        '-filter_complex', filterParts.join(';'),
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-preset', 'medium',
        '-y',
        outputVideo
      ]);
      
      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write('.');
      });
      
      ffmpeg.on('close', (code) => {
        process.stderr.write('\n');
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ジャンプカット処理に失敗しました: ${stderr}`));
        }
      });
    });
  } finally {
    // 一時ディレクトリのクリーンアップ
    await import('../utils/file').then(module => module.cleanupDirectory(tmpDir));
  }
}

// シーン検出と無音情報を組み合わせる関数
async function combineSceneAndSilenceInfo(
  sceneInfoFile: string,
  silenceInfoFile: string,
  videoPath: string,
  padding: number,
  minSegmentDuration: number
): Promise<{start: number, end: number}[]> {
  // 無音情報の読み込み
  const silenceInfoContent = await readFile(silenceInfoFile, 'utf-8');
  const silences = JSON.parse(silenceInfoContent) as {start: number, end: number, duration: number}[];
  
  // シーン検出情報の読み込みと解析
  const sceneInfoContent = await readFile(sceneInfoFile, 'utf-8');
  const sceneChanges = parseSceneChanges(sceneInfoContent);
  
  // 動画の長さを取得
  const videoInfo = await getVideoDuration(videoPath);
  const videoDuration = videoInfo.durationSec;
  
  // 維持するセグメントを決定
  // 無音部分 + 動きの少ない部分を削除
  const segments: {start: number, end: number}[] = [];
  let lastEnd = 0;
  
  // 無音情報を基本としてセグメントを作成
  for (const silence of silences) {
    // パディングを考慮した無音の開始・終了時間
    const silenceStart = Math.max(0, silence.start - padding);
    const silenceEnd = Math.min(videoDuration, silence.end + padding);
    
    // 前のセグメントの終わりから無音の開始までのセグメントを追加
    if (silenceStart - lastEnd >= minSegmentDuration) {
      segments.push({
        start: lastEnd,
        end: silenceStart
      });
    }
    
    lastEnd = silenceEnd;
  }
  
  // 最後のセグメント
  if (videoDuration - lastEnd >= minSegmentDuration) {
    segments.push({
      start: lastEnd,
      end: videoDuration
    });
  }
  
  // シーン情報を考慮して、動きの少ないセグメントをさらに絞り込む
  const refinedSegments = refineSegmentsWithSceneInfo(segments, sceneChanges, minSegmentDuration);
  
  console.log(`無音と動きを分析した結果、${refinedSegments.length}個のセグメントを維持します`);
  
  return refinedSegments;
}

// シーン検出情報を解析する関数
function parseSceneChanges(sceneInfo: string): number[] {
  const timestamps: number[] = [];
  const regex = /pts_time:(\d+\.?\d*)/g;
  
  let match;
  while ((match = regex.exec(sceneInfo)) !== null) {
    timestamps.push(parseFloat(match[1]));
  }
  
  return timestamps.sort((a, b) => a - b);
}

// シーン情報を考慮してセグメントを絞り込む関数
function refineSegmentsWithSceneInfo(
  segments: {start: number, end: number}[],
  sceneChanges: number[],
  minSegmentDuration: number
): {start: number, end: number}[] {
  const refinedSegments: {start: number, end: number}[] = [];
  
  for (const segment of segments) {
    // このセグメント内のシーン変化を抽出
    const segmentSceneChanges = sceneChanges.filter(
      time => time >= segment.start && time <= segment.end
    );
    
    // シーン変化が少ないセグメントは動きが少ないと判断
    if (segmentSceneChanges.length < 2) {
      // セグメントの長さが十分に長い場合のみ維持（短すぎるとジャンプカットが不自然になる）
      if (segment.end - segment.start >= minSegmentDuration * 2) {
        refinedSegments.push(segment);
      }
    } else {
      // シーン変化が多いセグメントは分割して保持
      let lastSceneTime = segment.start;
      
      for (const sceneTime of segmentSceneChanges) {
        const subSegmentDuration = sceneTime - lastSceneTime;
        
        // サブセグメントが十分な長さの場合のみ追加
        if (subSegmentDuration >= minSegmentDuration) {
          refinedSegments.push({
            start: lastSceneTime,
            end: sceneTime
          });
        }
        
        lastSceneTime = sceneTime;
      }
      
      // 最後のサブセグメント
      const finalSubSegmentDuration = segment.end - lastSceneTime;
      if (finalSubSegmentDuration >= minSegmentDuration) {
        refinedSegments.push({
          start: lastSceneTime,
          end: segment.end
        });
      }
    }
  }
  
  return refinedSegments;
}

// 直接動画ファイルを処理するサイレントカット関数（プロジェクトなし）
export async function processSilentCutDirect(
  videoPath: string,
  outputPath: string,
  threshold: number = -30,
  minSilenceDuration: number = 0.5,
  padding: number = 0.05,
  minSegmentDuration: number = 0.3,
  mode: string = 'silent'
): Promise<void> {
  try {
    if (!existsSync(videoPath)) {
      throw new Error(`入力動画ファイルが見つかりません: ${videoPath}`);
    }
    
    // 一時ディレクトリを作成
    const tmpDir = join(dirname(outputPath), 'tmp_silentcut');
    if (!existsSync(tmpDir)) {
      await mkdir(tmpDir, { recursive: true });
    }
    
    console.log(`無音検出処理を開始します...`);
    console.log(`無音判定: ${threshold}dB以下の音が${minSilenceDuration}秒以上続く部分`);
    console.log(`カットモード: ${mode === 'silent' ? 'サイレントカット（無音部分を削除）' : 'ジャンプカット（動きの少ない部分を削除）'}`);
    
    // 一時ファイルパス
    const silenceInfoFile = join(tmpDir, 'silence_info.txt');
    
    // ステップ1: 無音部分の検出
    await detectSilence(videoPath, silenceInfoFile, threshold, minSilenceDuration);
    
    // ステップ2: 無音情報の解析とカット処理
    if (mode === 'silent') {
      await cutSilentParts(videoPath, outputPath, silenceInfoFile, padding, minSegmentDuration);
    } else {
      await performJumpCut(videoPath, outputPath, silenceInfoFile, padding, minSegmentDuration);
    }
    
    console.log(`カット処理が完了しました！`);
    console.log(`元の動画: ${videoPath}`);
    console.log(`処理済み動画: ${outputPath}`);
    
    // 一時ファイルを削除
    try {
      await Bun.write(silenceInfoFile, '');
      await import('../utils/file').then(module => module.cleanupDirectory(tmpDir));
    } catch (e) {
      console.warn(`一時ファイルの削除に失敗しました: ${(e as Error).message}`);
    }
    
  } catch (error) {
    console.error(`サイレントカット処理中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
} 