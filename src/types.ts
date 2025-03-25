// 型定義
export interface ThemeEntry {
  start: string;
  end: string;
  theme: string;
}

export interface ProjectConfig {
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