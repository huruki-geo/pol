// components/TimelineCard.tsx
'use client';

import React from 'react'; // Removed useState as toggle is not needed

// Define types matching the API response (no translated_content)
interface MastodonStatus {
	id: string;
	created_at: string;
	content: string; // HTML content
	url: string;
	account: {
		acct: string;
	};
	instance_domain?: string;
	// translated_content?: string; <-- Removed
}


interface TimelineCardProps {
  status: MastodonStatus;
}

const TimelineCard: React.FC<TimelineCardProps> = ({ status }) => {
  // Removed showOriginal state

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString('ja-JP');
    } catch {
      return dateString;
    }
  };

  // Function to render content (basic sanitization)
  const renderContent = (htmlContent: string | undefined) => {
      if (!htmlContent) return '';
      // Basic sanitization
      return htmlContent
        .replace(/<p>/gi, '')
        .replace(/<\/p>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>/g, '') // Remove other tags
        .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, "'")
        .trim();
  }

  // Always display the original content after sanitization
  const displayContent = renderContent(status.content);

  return (
    <div className="border border-gray-200 rounded-lg p-4 shadow-sm bg-white">
      <div className="flex justify-between items-center mb-2 text-sm text-gray-500">
        {/* Consider hiding account.acct for more privacy if needed */}
        <span>@{status.account.acct} @{status.instance_domain}</span>
        <a href={status.url} target="_blank" rel="noopener noreferrer" className="hover:underline" title="View on Mastodon">
          {formatDate(status.created_at)}
        </a>
      </div>
      <div className="prose prose-sm max-w-none mb-3 whitespace-pre-wrap break-words">
        {/* Removed contentLabel and display the content directly */}
        {displayContent}
      </div>
      {/* Removed the toggle button */}
    </div>
  );
};

export default TimelineCard;