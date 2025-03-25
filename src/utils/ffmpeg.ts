import { spawn } from 'child_process';
import { existsSync } from 'fs';

// 動画の長さを取得する関数
export async function getVideoDuration(videoPath: string): Promise<{durationSec: number}> {
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

// 無音部分を検出する関数
export async function detectSilence(
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
        resolve();
      } else {
        reject(new Error(`無音検出に失敗しました: ${stderr}`));
      }
    });
  });
}

// 日本語フォントを探す関数
export async function findJapaneseFont(): Promise<string> {
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