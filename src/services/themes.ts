import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import open from 'open';
import type { ThemeEntry } from '../types';
import { loadConfig, updateConfig } from '../utils/file';
import { estimateSrtTokens, getModelMaxTokens, cleanJsonString } from '../utils/themes';
import { parseSrt, formatSubtitlesToSrt } from '../utils/srt';
import { mergeOverlappingThemes } from '../utils/themes';

// テーマ抽出関数
export async function extractThemes(
  projectDir: string, 
  apiKey?: string, 
  model?: string,
  provider?: string
): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    // APIキーを取得（引数 > 環境変数 > 保存済み設定）
    const providedProvider = provider || config.modelProvider || 'google';
    const providerEnvVar = providedProvider === 'google' ? 'GOOGLE_API_KEY' : 'OPENAI_API_KEY';
    const apiKeyEnvVar = process.env[providerEnvVar];
    
    const aiApiKey = apiKey || apiKeyEnvVar || config.apiKey;
    if (!aiApiKey) {
      throw new Error(`${providedProvider === 'google' ? 'Google' : 'OpenAI'} APIキーが必要です。--api-key オプション、.envファイル、または${providerEnvVar}環境変数で指定してください。`);
    }
    
    // モデルを設定
    const aiModel = model || config.model || (providedProvider === 'google' ? 'gemini-1.5-flash' : 'gpt-3.5-turbo');
    
    // 設定を更新
    config.apiKey = aiApiKey;
    config.model = aiModel;
    config.modelProvider = providedProvider;
    await updateConfig(config);
    
    if (!existsSync(config.srtFile)) {
      throw new Error(`字幕ファイルが見つかりません: ${config.srtFile}`);
    }
    
    // SRTファイルを読み込む
    const srtContent = await readFile(config.srtFile, 'utf-8');
    
    console.log(`字幕からテーマを抽出中... (プロバイダー: ${providedProvider}, モデル: ${aiModel})`);
    
    // SRTファイルの大きさをチェック
    const estimatedTokens = estimateSrtTokens(srtContent);
    const maxTokens = getModelMaxTokens(aiModel, providedProvider);
    const promptOverhead = 500; // システムプロンプトとユーザープロンプトの追加トークン数（概算）
    
    console.log(`字幕の推定トークン数: 約${estimatedTokens}トークン`);
    console.log(`${aiModel}の最大トークン数: ${maxTokens}トークン`);
    
    let themes: ThemeEntry[] = [];
    
    if (estimatedTokens + promptOverhead > maxTokens) {
      // 字幕が大きすぎる場合は分割処理
      console.log(`字幕が長いため、分割処理を行います...`);
      themes = await processLargeSrt(srtContent, aiApiKey, aiModel, providedProvider);
    } else {
      // 通常処理
      console.log(`通常の処理で字幕を分析します...`);
      try {
        themes = await extractThemesWithAI(srtContent, aiApiKey, aiModel, providedProvider);
      } catch (error) {
        // 強制分割エラーをチェック
        if ((error as Error).message === 'FORCE_SPLIT') {
          console.log('APIがコンテキスト長超過を報告したため、分割処理に切り替えます...');
          themes = await processLargeSrt(srtContent, aiApiKey, aiModel, providedProvider);
        } else {
          throw error;
        }
      }
    }
    
    // テーマをJSONファイルに保存
    await writeFile(config.themesFile, JSON.stringify(themes, null, 2), 'utf-8');
    
    console.log(`テーマを抽出し保存しました: ${config.themesFile}`);
    console.log('次のステップ:');
    console.log(`1. テーマを確認・編集: bun run index.ts edit-themes -p ${projectDir}`);
    console.log(`2. 最終動画を作成: bun run index.ts create-video -p ${projectDir}`);
  } catch (error) {
    console.error(`テーマ抽出中にエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
}

// プロバイダーに応じて適切なAI APIを呼び出す関数
export async function extractThemesWithAI(
  srtContent: string, 
  apiKey: string, 
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  if (provider === 'google') {
    return extractThemesWithGemini(srtContent, apiKey, model);
  } else {
    return extractThemesWithOpenAI(srtContent, apiKey, model);
  }
}

// OpenAI APIを使用してテーマを抽出する関数
export async function extractThemesWithOpenAI(
  srtContent: string, 
  apiKey: string, 
  model: string
): Promise<ThemeEntry[]> {
  const systemPrompt = `
あなたは動画内の話題やテーマを正確に抽出する専門家です。
SRT字幕ファイルを分析して、動画内で話されている主要なテーマとその時間範囲を特定してください。
特に「〜について」「〜とは」「〜の方法」などの表現や、話題の転換点に注目してください。
結果は指定されたJSON形式でのみ出力し、追加の説明は不要です。

字幕が部分的なものである場合も、その部分だけでテーマを抽出してください。
`;

  const userPrompt = `
以下のSRT字幕を分析して、動画内の主要なテーマとその時間範囲を特定してください。
1つのセグメントに複数のトピックが含まれる場合は、複数のエントリに分けてください。

結果は以下のJSON形式で出力してください：

[
  {"start": "00:01:15,500", "end": "00:03:45,800", "theme": "AIの歴史について"},
  {"start": "00:03:46,000", "end": "00:07:30,200", "theme": "機械学習の応用について"}
]

他の解説は不要です。JSONのみを出力してください。

字幕ファイル：
${srtContent}
`;

  try {
    // OpenAI APIを呼び出し
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API エラー: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    let content = data.choices[0].message.content;
    
    // JSONの部分だけを抽出
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      content = content.substring(jsonStart, jsonEnd);
    }
    
    // JSONをパース
    try {
      return JSON.parse(content) as ThemeEntry[];
    } catch (error) {
      console.warn(`テーマJSONのパースに失敗: ${(error as Error).message}`);
      console.warn(`受信したJSON: ${content}`);
      
      // JSONの修正を試みる
      const cleanedJson = cleanJsonString(content);
      try {
        return JSON.parse(cleanedJson) as ThemeEntry[];
      } catch (secondError) {
        throw new Error(`JSON修正後もパースに失敗: ${(secondError as Error).message}`);
      }
    }
  } catch (error) {
    if ((error as Error).message.includes('context_length_exceeded') || 
        (error as Error).message.includes('maximum context length')) {
      console.error('テキストがモデルの最大コンテキスト長を超えています。自動的に分割処理を行います。');
      throw new Error('FORCE_SPLIT');
    }
    throw error;
  }
}

// Gemini APIを使用してテーマを抽出する関数
export async function extractThemesWithGemini(
  srtContent: string, 
  apiKey: string, 
  model: string
): Promise<ThemeEntry[]> {
  const prompt = `
あなたは動画内の話題やテーマを正確に抽出する専門家です。
SRT字幕ファイルを分析して、動画内で話されている主要なテーマとその時間範囲を特定してください。
特に「〜について」「〜とは」「〜の方法」などの表現や、話題の転換点に注目してください。
結果は指定されたJSON形式でのみ出力し、追加の説明は不要です。

字幕が部分的なものである場合も、その部分だけでテーマを抽出してください。

以下のSRT字幕を分析して、動画内の主要なテーマとその時間範囲を特定してください。
1つのセグメントに複数のトピックが含まれる場合は、複数のエントリに分けてください。

結果は以下のJSON形式で出力してください：

[
  {"start": "00:01:15,500", "end": "00:03:45,800", "theme": "AIの歴史について"},
  {"start": "00:03:46,000", "end": "00:07:30,200", "theme": "機械学習の応用について"}
]

他の解説は不要です。JSONのみを出力してください。

字幕ファイル：
${srtContent}
`;

  try {
    // Gemini APIを呼び出し
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google AI API エラー: ${JSON.stringify(errorData)}`);
    }
    
    const data = await response.json();
    
    // Gemini API のレスポンス形式から内容を抽出
    let content = '';
    try {
      content = data.candidates[0].content.parts[0].text;
    } catch (error) {
      throw new Error(`Gemini APIからの応答解析に失敗しました: ${(error as Error).message}`);
    }
    
    // JSONの部分だけを抽出
    const jsonStart = content.indexOf('[');
    const jsonEnd = content.lastIndexOf(']') + 1;
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      content = content.substring(jsonStart, jsonEnd);
    }
    
    // JSONをパース
    try {
      return JSON.parse(content) as ThemeEntry[];
    } catch (error) {
      console.warn(`テーマJSONのパースに失敗: ${(error as Error).message}`);
      console.warn(`受信したJSON: ${content}`);
      
      // JSONの修正を試みる
      const cleanedJson = cleanJsonString(content);
      try {
        return JSON.parse(cleanedJson) as ThemeEntry[];
      } catch (secondError) {
        throw new Error(`JSON修正後もパースに失敗: ${(secondError as Error).message}`);
      }
    }
  } catch (error) {
    if ((error as Error).message.includes('Invalid model') || 
        (error as Error).message.includes('Quota exceeded')) {
      console.error(`Gemini API エラー: ${(error as Error).message}`);
    }
    
    if ((error as Error).message.includes('content too long') || 
        (error as Error).message.includes('exceeds maximum context length')) {
      console.error('テキストがモデルの最大コンテキスト長を超えています。自動的に分割処理を行います。');
      throw new Error('FORCE_SPLIT');
    }
    throw error;
  }
}

// 大きなSRTファイルを分割処理する関数
export async function processLargeSrt(
  srtContent: string, 
  apiKey: string, 
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  // SRTをパースして字幕エントリのリストを取得
  const subtitles = parseSrt(srtContent);
  
  // モデルのトークン数制限に基づいてチャンクサイズを設定
  const maxTokens = getModelMaxTokens(model, provider);
  const promptOverhead = 500;
  const maxContentTokens = maxTokens - promptOverhead;
  
  // 1チャンクあたりの最大字幕数を計算（安全マージンを持たせる）
  const averageSubtitleLength = srtContent.length / subtitles.length;
  const averageSubtitleTokens = averageSubtitleLength / 4; // 文字数の約1/4がトークン数と仮定
  const subtitlesPerChunk = Math.floor(maxContentTokens / averageSubtitleTokens / 4); // より小さく分割（4で割る）
  
  const numChunks = Math.ceil(subtitles.length / subtitlesPerChunk);
  console.log(`字幕を約${numChunks}個のチャンクに分割して処理します (1チャンクあたり約${subtitlesPerChunk}行)`);
  
  // 字幕を適切なチャンクに分割
  const chunks: string[] = [];
  for (let i = 0; i < subtitles.length; i += subtitlesPerChunk) {
    const chunkSubtitles = subtitles.slice(i, i + subtitlesPerChunk);
    chunks.push(formatSubtitlesToSrt(chunkSubtitles));
  }
  
  // 各チャンクを処理
  const allThemes: ThemeEntry[] = [];
  
  for (let i = 0; i < chunks.length; i++) {
    console.log(`チャンク ${i+1}/${chunks.length} を処理中...`);
    try {
      const chunkThemes = await extractThemesWithAI(chunks[i], apiKey, model, provider);
      allThemes.push(...chunkThemes);
    } catch (error) {
      // エラーの種類を確認
      if ((error as Error).message === 'FORCE_SPLIT' && chunks[i].length > 1000) {
        // さらに小さく分割する必要がある場合
        console.log('このチャンクをさらに小さく分割します...');
        // 再帰的に処理する
        const subChunks = await splitAndProcessChunk(chunks[i], apiKey, model, provider);
        allThemes.push(...subChunks);
      } else {
        // その他のエラーは再スロー
        throw error;
      }
    }
  }
  
  // 重複するテーマをマージ
  return mergeOverlappingThemes(allThemes);
}

// 個別のチャンクをさらに小さく分割して処理する関数
export async function splitAndProcessChunk(
  chunk: string,
  apiKey: string,
  model: string,
  provider: string = 'openai'
): Promise<ThemeEntry[]> {
  // SRTをパースして字幕エントリのリストを取得
  const subtitles = parseSrt(chunk);
  
  // さらに小さいチャンクに分割（元のサイズの1/4程度）
  const subChunkSize = Math.max(5, Math.ceil(subtitles.length / 4));
  
  console.log(`サブチャンク処理: ${subtitles.length}行を${Math.ceil(subtitles.length / subChunkSize)}個に分割`);
  
  const subChunks: string[] = [];
  for (let i = 0; i < subtitles.length; i += subChunkSize) {
    const subChunkSubtitles = subtitles.slice(i, i + subChunkSize);
    subChunks.push(formatSubtitlesToSrt(subChunkSubtitles));
  }
  
  // 各サブチャンクを処理
  const results: ThemeEntry[] = [];
  
  for (let i = 0; i < subChunks.length; i++) {
    console.log(`サブチャンク ${i+1}/${subChunks.length} を処理中...`);
    try {
      const subThemes = await extractThemesWithAI(subChunks[i], apiKey, model, provider);
      results.push(...subThemes);
    } catch (error) {
      // 極小チャンクでもエラーが出る場合はスキップ
      if ((error as Error).message === 'FORCE_SPLIT') {
        console.warn(`サブチャンク ${i+1} は処理できませんでした - スキップします`);
        continue;
      }
      throw error;
    }
  }
  
  return results;
}

// テーマJSONファイルをエディタで開く関数
export async function openThemesEditor(projectDir: string): Promise<void> {
  try {
    const config = await loadConfig(projectDir);
    
    if (!existsSync(config.themesFile)) {
      throw new Error(`テーマJSONファイルが見つかりません: ${config.themesFile}`);
    }
    
    console.log(`テーマJSONファイルをエディタで開きます: ${config.themesFile}`);
    await open(config.themesFile);
    
    console.log('テーマを確認・編集したら、次のステップに進みます:');
    console.log(`最終動画を作成: bun run index.ts create-video -p ${projectDir}`);
  } catch (error) {
    console.error(`テーマエディタを開くときにエラーが発生しました: ${(error as Error).message}`);
    process.exit(1);
  }
} 