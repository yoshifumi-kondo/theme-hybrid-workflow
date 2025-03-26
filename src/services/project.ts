import { join, basename } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { ProjectConfig } from '../types';

// プロジェクト初期化関数
export async function initProject(videoPath: string, projectDir: string, language: string): Promise<void> {
  // プロジェクトディレクトリが存在しない場合は作成
  if (!existsSync(projectDir)) {
    await mkdir(projectDir, { recursive: true });
  }

  // 設定ファイルパス
  const configPath = join(projectDir, 'project_config.json');
  
  // 既存の設定ファイルがある場合は読み込む
  let config: ProjectConfig;
  
  if (existsSync(configPath)) {
    const content = await import('fs/promises').then(fs => fs.readFile(configPath, 'utf-8'));
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
  console.log(`1. 字幕を抽出: bun run extract-subtitles -p ${projectDir}`);
}

// ユーザーの確認を待つ関数
export async function waitForUserConfirmation(message: string): Promise<void> {
  console.log(message);
  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      resolve();
    });
  });
} 