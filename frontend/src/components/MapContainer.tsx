import React, { useEffect, useRef } from 'react';
import { olService } from '../lib/openlayers';

/**
 * MapContainer.tsx — React wrapper for the OpenLayers map.
 *
 * Responsibilities:
 *  - Provide a DOM ref for OpenLayers to attach to
 *  - Initialize the map on mount
 */
const MapContainer: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mapRef.current) {
      olService.initialize(mapRef.current);
    }
  }, []);

  return <div ref={mapRef} className="ol-map-container" />;
};

export default MapContainer;
