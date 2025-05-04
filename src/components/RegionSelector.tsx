// src/components/RegionSelector.tsx
'use client';

import React from 'react';

interface RegionSelectorProps {
  /**
   * Key: region code (e.g., "DE"), Value: display name (e.g., "Germany (DE)")
   */
  regions: Record<string, string>;
  /** Currently selected region code */
  selectedRegion: string;
  /** Callback function when region is selected */
  onSelectRegion: (regionCode: string) => void;
  /** Whether the selector should be disabled */
  disabled?: boolean;
}

const RegionSelector: React.FC<RegionSelectorProps> = ({
  regions,
  selectedRegion,
  onSelectRegion,
  disabled = false // デフォルトは false
}) => {
  const regionCodes = Object.keys(regions);

  return (
    <div className="my-2 flex items-center space-x-2">
      <label htmlFor="region-select" className="font-medium text-gray-700 whitespace-nowrap">Select Region:</label>
      <select
        id="region-select"
        value={selectedRegion}
        onChange={(e) => onSelectRegion(e.target.value)}
        className={`border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm ${disabled ? 'opacity-50 bg-gray-100 cursor-not-allowed' : ''}`}
        disabled={disabled || regionCodes.length === 0} // disabled 状態と選択肢がない場合に無効化
        aria-label="Select Region"
      >
        {/* 地域がまだ選択されていない、またはリストが空の場合のプレースホルダー */}
        {(regionCodes.length === 0 || !selectedRegion) && (
             <option value="" disabled>
                {regionCodes.length === 0 ? 'No regions available' : '-- Select --'}
             </option>
         )}

        {/* APIから取得した地域のリストをオプションとして表示 */}
        {regionCodes.map((code) => (
          <option key={code} value={code}>
             {/* regions オブジェクトから表示名を取得 */}
            {regions[code]}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RegionSelector;