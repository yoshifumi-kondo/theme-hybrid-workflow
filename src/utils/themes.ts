import type { ThemeEntry } from '../types';
import { timeToSeconds } from './format';

// 重複するテーマをマージする関数
export function mergeOverlappingThemes(themes: ThemeEntry[]): ThemeEntry[] {
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
export function areSimilarThemes(theme1: string, theme2: string): boolean {
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

// JSON文字列を修正する関数
export function cleanJsonString(jsonStr: string): string {
  // 末尾のカンマを修正
  let cleaned = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
  
  // シングルクォートをダブルクォートに変換
  cleaned = cleaned.replace(/'/g, '"');
  
  // JSONキーをダブルクォートで囲む
  cleaned = cleaned.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
  return cleaned;
}

// モデルごとの最大トークン数を取得
export function getModelMaxTokens(model: string, provider: string = 'openai'): number {
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
export function estimateSrtTokens(srtContent: string): number {
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