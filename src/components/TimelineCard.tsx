// components/TimelineCard.tsx
'use client';

import React from 'react';
import { formatDistanceToNow } from 'date-fns'; // date-fns からインポート
import { ja } from 'date-fns/locale'; // 日本語ロケールをインポート
import { FiExternalLink } from 'react-icons/fi'; // react-icons からアイコンをインポート (任意)

interface MastodonStatus {
	id: string;
	created_at: string;
	content: string;
	url: string;
	account: {
		acct: string;
	};
	instance_domain?: string;
}

interface TimelineCardProps {
  status: MastodonStatus;
}

// HTML をサニタイズして表示するためのヘルパー（簡易版）
// 注意: より安全性を高めるには DOMPurify などのライブラリの使用を検討してください。
const renderSanitizedContent = (htmlContent: string) => {
  if (typeof window === 'undefined') {
    // サーバーサイドでは単純にタグを除去（より良い方法があれば検討）
     return htmlContent.replace(/<[^>]*>/g, ' ').replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'").trim();
  }
  // クライアントサイドで DOMParser を使う（より安全な方法）
  const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
  // 必要に応じて特定のタグや属性のみを許可する処理を追加できます
  // ここでは単純にtextContentを取得（タグは除去される）
  // <p> や <br> を改行に変換する処理を追加
  let textContent = '';
  doc.body.childNodes.forEach(node => {
    if (node.nodeName === 'P') {
      textContent += node.textContent + '\n';
    } else if (node.nodeName === 'BR') {
      textContent += '\n';
    } else if (node.textContent) {
      textContent += node.textContent;
    }
  });
  return textContent.trim();
};


const TimelineCard: React.FC<TimelineCardProps> = ({ status }) => {

  // 日付を相対時間でフォーマット (例: "5分前")
  const timeAgo = React.useMemo(() => {
      try {
          return formatDistanceToNow(new Date(status.created_at), { addSuffix: true, locale: ja });
      } catch {
          return status.created_at; // エラー時は元の文字列
      }
  }, [status.created_at]);

  // ユーザーのプロフィールURLを生成 (推測)
  const userProfileUrl = `https://${status.instance_domain}/@${status.account.acct.includes('@') ? status.account.acct.split('@')[0] : status.account.acct}`;
  // status.account.acct が 'user' のような形式の場合と 'user@domain' の形式の場合に対応

  const displayContent = renderSanitizedContent(status.content);

  return (
    <div className="border border-gray-200 rounded-lg shadow-sm bg-white overflow-hidden transition hover:shadow-md">
      {/* カードヘッダー: アカウント情報 */}
      <div className="p-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
        <a
          href={userProfileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-gray-700 hover:text-blue-600 hover:underline break-all"
          title={`View profile: @${status.account.acct}@${status.instance_domain}`}
        >
          @{status.account.acct}@{status.instance_domain}
        </a>
        {/* 元投稿へのリンク (アイコン) */}
        <a
          href={status.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-blue-600"
          title="View original post on Mastodon"
        >
          <FiExternalLink size={16} />
        </a>
      </div>

      {/* 投稿本文 */}
      <div className="p-4 prose prose-sm max-w-none whitespace-pre-wrap break-words text-gray-800">
        {displayContent}
      </div>

      {/* カードフッター: 投稿日時 */}
      <div className="p-3 bg-gray-50 border-t border-gray-200 text-right">
        <a
          href={status.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
          title={`Posted at: ${new Date(status.created_at).toLocaleString('ja-JP')}`}
        >
          {timeAgo}
        </a>
      </div>
    </div>
  );
};

export default TimelineCard;