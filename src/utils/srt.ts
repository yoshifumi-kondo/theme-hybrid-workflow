import { adjustSrtTimestamps } from './format';

// SRTを字幕エントリに分解する関数
export function parseSrt(srtContent: string): {id: number, start: string, end: string, text: string}[] {
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
export function formatSubtitlesToSrt(subtitles: {id: number, start: string, end: string, text: string}[]): string {
  return subtitles.map(sub => {
    return `${sub.id}\n${sub.start} --> ${sub.end}\n${sub.text}\n`;
  }).join('\n');
}

// 複数のSRTファイルを結合する関数
export function combineSrtFiles(srtContents: string[]): string {
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

export { adjustSrtTimestamps }; 