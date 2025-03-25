import { program } from 'commander';
import { existsSync } from 'fs';
import { initProject, waitForUserConfirmation } from '../services/project';
import { extractSubtitles, openSubtitlesEditor } from '../services/subtitles';
import { extractThemes, openThemesEditor } from '../services/themes';
import { createFinalVideo, processSilentCut, processSilentCutDirect } from '../services/video';

// コマンドラインオプションの設定
export function setupCommands() {
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
    .option('--cut-threshold <dB>', '無音と判定する音量しきい値 (dB)', '-30')
    .option('--cut-duration <seconds>', '無音と判定する最小時間 (秒)', '0.5')
    .option('--cut-mode <mode>', 'カットモード (silent/jump)', 'silent')
    .action(async (options) => {
      await runAllSteps(
        options.input,
        options.dir,
        options.language,
        options.apiKey,
        options.model,
        options.provider,
        parseInt(options.fontSize),
        parseFloat(options.bgOpacity),
        {
          threshold: parseFloat(options.cutThreshold),
          duration: parseFloat(options.cutDuration),
          mode: options.cutMode
        }
      );
    });

  // サブコマンド: サイレントカット処理
  program
    .command('silent-cut')
    .description('動画の無音部分を検出して自動カット')
    .option('-p, --project <path>', 'プロジェクトディレクトリ')
    .argument('[videoPath]', '動画ファイルパス (プロジェクトの代わりに直接指定可能)')
    .option('-t, --threshold <dB>', '無音と判定する音量しきい値 (dB)', '-30')
    .option('-d, --duration <seconds>', '無音と判定する最小時間 (秒)', '0.5')
    .option('--padding <seconds>', 'カット前後に残す時間 (秒)', '0.05')
    .option('-m, --min-segment <seconds>', '保持する最小セグメント長 (秒)', '0.3')
    .option('--mode <mode>', 'カットモード (silent/jump)', 'silent')
    .option('-o, --output <path>', '出力ファイルパス', '')
    .action(async (videoPath, options) => {
      if (!options.project && !videoPath) {
        console.error('エラー: プロジェクトディレクトリ(-p)または動画ファイルパスのどちらかが必要です');
        process.exit(1);
      }
      
      // 動画ファイルが直接指定された場合の処理
      if (videoPath && !options.project) {
        if (!existsSync(videoPath)) {
          console.error(`エラー: 指定された動画ファイルが見つかりません: ${videoPath}`);
          process.exit(1);
        }
        
        // 出力ファイル名を生成
        const outputPath = options.output || videoPath.replace(/\.[^/.]+$/, '') + '_silent_cut.mp4';
        
        // 直接動画ファイルを処理する新しい機能を呼び出す
        await processSilentCutDirect(
          videoPath,
          outputPath,
          parseFloat(options.threshold), 
          parseFloat(options.duration),
          parseFloat(options.padding),
          parseFloat(options.minSegment),
          options.mode
        );
        return;
      }
      
      // 従来のプロジェクトベースの処理
      await processSilentCut(
        options.project, 
        parseFloat(options.threshold), 
        parseFloat(options.duration),
        parseFloat(options.padding),
        parseFloat(options.minSegment),
        options.mode
      );
    });

  // コマンドラインパラメータを解析
  program.parse();
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
  bgOpacity: number,
  silentCutOptions?: {
    threshold?: number,
    duration?: number,
    padding?: number,
    minSegment?: number,
    mode?: string
  }
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
    
    // ステップ1.5: サイレントカット処理
    console.log('\n--- ステップ 1.5: サイレントカット処理 ---');
    await processSilentCut(
      projectDir,
      silentCutOptions?.threshold || -30,
      silentCutOptions?.duration,
      silentCutOptions?.padding,
      silentCutOptions?.minSegment,
      silentCutOptions?.mode || 'silent'
    );
    
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
    const config = await import('../utils/file').then(module => module.loadConfig(projectDir));
    console.log(`最終動画: ${config.outputFile}`);
  } catch (error) {
    console.error(`ワークフロー実行中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
} 