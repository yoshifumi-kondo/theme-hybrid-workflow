#!/usr/bin/env bun
import { existsSync } from 'fs';
import { setupCommands } from './commands';

// Bunは自動的に.envファイルを読み込みます
if (existsSync('.env')) {
  console.log('✅ .envファイルを読み込みました');
} else {
  console.log('⚠️ .envファイルが見つかりません。コマンドラインオプションまたは環境変数で指定してください。');
}

// コマンドを設定して実行
setupCommands(); 