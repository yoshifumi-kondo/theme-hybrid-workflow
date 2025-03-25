// 時間をフォーマットする関数
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// SRTの時間文字列を秒数に変換する関数
export function timeToSeconds(timeStr: string): number {
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  const milliseconds = parseInt(match[4]);
  
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

// SRTのタイムスタンプを調整する関数
export function adjustSrtTimestamps(srtContent: string, offsetSeconds: number): string {
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

// SRTの時間形式（00:00:00,000）をASS形式（0:00:00.00）に変換
export function convertSrtTimeToAss(srtTime: string): string {
  const match = srtTime.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return '0:00:00.00';
  
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]).toString().padStart(2, '0');
  const seconds = parseInt(match[3]).toString().padStart(2, '0');
  const milliseconds = parseInt(match[4].substring(0, 2)).toString().padStart(2, '0'); // ASSは2桁のみ
  
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// 秒数をASS時間形式（0:00:00.00）に変換
export function convertSecondsToAss(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 100).toString().padStart(2, '0');
  
  return `${hours}:${minutes}:${secs}.${ms}`;
} 