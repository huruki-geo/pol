// src/components/SentimentDisplay.tsx
'use client';

import React from 'react';

interface SentimentAnalysisData {
    positivePercentage: number;
    negativePercentage: number;
    neutralPercentage: number;
    totalAnalyzed: number;
    counts: { positive: number; negative: number; neutral: number };
}

interface SentimentDisplayProps {
  data: SentimentAnalysisData;
}

const SentimentDisplay: React.FC<SentimentDisplayProps> = ({ data }) => {
  const { positivePercentage, negativePercentage, neutralPercentage, totalAnalyzed, counts } = data;

  if (totalAnalyzed === 0) {
      return <p className="text-center text-gray-500 text-sm">Could not analyze sentiment for this timeline.</p>;
  }

  return (
    <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
        <p className="text-sm text-center text-gray-600 mb-3">
            Based on {totalAnalyzed} analyzed posts:
        </p>
        <div className="space-y-2">
            {/* Positive Bar */}
            <div className="flex items-center">
                <span className="w-16 text-sm font-medium text-green-600">😊 Pos:</span>
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mr-2">
                    <div
                        className="bg-green-500 h-4 rounded-full"
                        style={{ width: `${positivePercentage}%` }}
                        title={`${counts.positive} posts`}
                    ></div>
                </div>
                <span className="text-sm font-semibold w-10 text-right">{positivePercentage}%</span>
            </div>
            {/* Negative Bar */}
            <div className="flex items-center">
                <span className="w-16 text-sm font-medium text-red-600">😠 Neg:</span>
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mr-2">
                    <div
                        className="bg-red-500 h-4 rounded-full"
                        style={{ width: `${negativePercentage}%` }}
                         title={`${counts.negative} posts`}
                   ></div>
                </div>
                <span className="text-sm font-semibold w-10 text-right">{negativePercentage}%</span>
            </div>
            {/* Neutral Bar */}
             <div className="flex items-center">
                <span className="w-16 text-sm font-medium text-gray-600">😐 Neu:</span>
                <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden mr-2">
                    <div
                        className="bg-gray-400 h-4 rounded-full"
                        style={{ width: `${neutralPercentage}%` }}
                         title={`${counts.neutral} posts`}
                   ></div>
                </div>
                <span className="text-sm font-semibold w-10 text-right">{neutralPercentage}%</span>
            </div>
        </div>
    </div>
  );
};

export default SentimentDisplay;