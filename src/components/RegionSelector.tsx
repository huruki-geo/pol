'use client';

import React from 'react';

interface RegionSelectorProps {
  regions: Record<string, string>; // Key: Code (EU, DE), Value: Display Name (EU, Germany)
  selectedRegion: string;
  onSelectRegion: (regionCode: string) => void;
}

const RegionSelector: React.FC<RegionSelectorProps> = ({ regions, selectedRegion, onSelectRegion }) => {
  return (
    <div className="my-4">
      <label htmlFor="region-select" className="mr-2 font-semibold">Select Region:</label>
      <select
        id="region-select"
        value={selectedRegion}
        onChange={(e) => onSelectRegion(e.target.value)}
        className="border border-gray-300 rounded p-2"
      >
        {Object.entries(regions).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default RegionSelector;