import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { ProjectConfig } from '../types';

// 設定ファイルを読み込む関数
export async function loadConfig(projectDir: string): Promise<ProjectConfig> {
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
export async function updateConfig(config: ProjectConfig): Promise<void> {
  try {
    const configPath = join(config.projectDir, 'project_config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error(`設定ファイルの更新中にエラーが発生しました: ${(error as Error).message}`);
  }
}

// 一時ディレクトリ内のファイルを削除する関数
export async function cleanupDirectory(dirPath: string): Promise<void> {
  try {
    // Node.jsのfsモジュールを使用してディレクトリ内のファイル一覧を取得
    const files = await new Promise<string[]>((resolve, reject) => {
      import('fs').then(fs => {
        fs.readdir(dirPath, (err, files) => {
          if (err) reject(err);
          else resolve(files);
        });
      }).catch(reject);
    });
    
    // 各ファイルを削除
    for (const file of files) {
      const filePath = join(dirPath, file);
      await new Promise<void>((resolve, reject) => {
        import('fs').then(fs => {
          fs.unlink(filePath, err => {
            if (err) console.warn(`ファイル ${filePath} の削除に失敗しました: ${err.message}`);
            resolve();
          });
        }).catch(err => {
          console.warn(`ファイル ${filePath} の削除中にエラーが発生しました: ${err.message}`);
          resolve();
        });
      });
    }
    
    console.log(`${files.length} 個の一時ファイルを削除しました`);
  } catch (error) {
    console.warn(`ディレクトリのクリーンアップ中にエラーが発生しました: ${(error as Error).message}`);
  }
} 