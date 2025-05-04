import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import globals from "globals"; // Node.js やブラウザのグローバル変数を定義

// TypeScript 用パーサーとプラグイン
import typescriptParser from "@typescript-eslint/parser";
import typescriptPlugin from "@typescript-eslint/eslint-plugin";

// React/Next.js 関連プラグイン (FlatCompat で読み込む場合、直接 import は不要な場合も)
// import reactPlugin from "eslint-plugin-react";
// import reactHooksPlugin from "eslint-plugin-react-hooks";
// import nextPlugin from "@next/eslint-plugin-next"; // パッケージ名は "@next/eslint-plugin-next" のはず
// import jsxA11yPlugin from "eslint-plugin-jsx-a11y";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FlatCompat インスタンス (従来の eslintrc 形式の設定を読み込むため)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  // RecommendedConfigs: eslintrcRecommended, // 必要なら
  // RulePlugins: { ... } // 必要なら
});

/** @type {import('eslint').Linter.FlatConfig[]} */
const eslintConfig = [
  // 1. グローバル設定と Next.js の基本設定 (compat.extends を使用)
  // compat.extends は配列を返すので展開する
  ...compat.extends(
    "next/core-web-vitals" // Next.js 推奨の基本ルールセット (React, Hooks, a11y などを含むはず)
                           // これが TypeScript 用の設定も含むか確認が必要
                           // 必要なら "plugin:@typescript-eslint/recommended" なども追加
    // "eslint:recommended", // ESLint の基本推奨ルール (core-web-vitals に含まれるか？)
  ),

  // 2. グローバル変数の設定
  {
    languageOptions: {
      globals: {
        ...globals.browser, // ブラウザ環境のグローバル変数 (window, document など)
        ...globals.node,    // Node.js 環境のグローバル変数 (process など) - APIルート用
        React: "readonly",  // React 17以降の新しいJSX Transformでは不要な場合も
      }
    }
  },

  // 3. TypeScript ファイル (.ts, .tsx) 用の詳細設定
  {
    files: ["**/*.ts", "**/*.tsx"], // 対象ファイル
    languageOptions: {
      parser: typescriptParser, // TypeScript パーサーを指定
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        project: "./tsconfig.json", // tsconfig.json のパス (型情報を使うルールのため)
        // jsxPragma: null, // React 17+ JSX Transform
      },
    },
    plugins: {
      // TypeScript ESLint プラグイン
      "@typescript-eslint": typescriptPlugin,
      // React/Hooks/Next/a11y は next/core-web-vitals に含まれるはずだが、
      // 明示的に設定したい場合や Flat Config ネイティブで使いたい場合は追加
      // react: reactPlugin,
      // "react-hooks": reactHooksPlugin,
      // "@next/next": nextPlugin,
      // "jsx-a11y": jsxA11yPlugin,
    },
    rules: {
      // --- TypeScript ESLint ルール ---
      // Next.js推奨ルールに含まれるものをベースに、必要なものを上書き・追加

      // 以前問題になったルールを設定
      "@typescript-eslint/no-namespace": "off", // `declare global namespace NodeJS` を許可
      "@typescript-eslint/no-explicit-any": "warn", // `any` の使用は警告のみにする (ビルドは通る)
      "@typescript-eslint/no-unused-vars": [ // 未使用変数ルール
        "warn", // 警告のみにする
        {
          "argsIgnorePattern": "^_", // アンダースコアで始まる引数は無視
          "varsIgnorePattern": "^_", // アンダースコアで始まる変数も無視
          "caughtErrors": "none", // catch ブロックのエラー変数は無視 (例: catch (e))
        }
      ],

      // --- 一般的なルール ---
      "prefer-const": "warn", // 再代入されない変数は const を推奨 (警告のみ)

      // --- React/Next.js 関連ルール (next/core-web-vitals で設定されている可能性あり) ---
      // "react/prop-types": "off", // TypeScript では不要
      // "react/react-in-jsx-scope": "off", // React 17+ JSX Transform では不要
      // "react-hooks/rules-of-hooks": "error",
      // "react-hooks/exhaustive-deps": "warn",
      // "@next/next/no-html-link-for-pages": "off", // App Router では不要な場合あり

      // --- 必要に応じて他のルールを追加 ---
    },
    settings: {
      react: {
        version: "detect", // React のバージョンを自動検出
      },
    }
  },

  // 4. 特定のファイルタイプに対するルール除外など (例)
  // {
  //   files: ["eslint.config.js"], // 設定ファイル自体
  //   languageOptions: { sourceType: "commonjs" } // CommonJSの場合
  // },
  // {
  //   ignores: ["node_modules/", ".next/", ".vercel/"] // 無視するディレクトリ
  // }
];

export default eslintConfig;