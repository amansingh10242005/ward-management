import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toLonLat } from 'ol/proj';
import Map from 'ol/Map';
import { olService } from '../lib/openlayers';
import { IconCoordinateTarget } from './Icons';

/**
 * Computes standard UTM Zone from WGS84 Lat/Lon (e.g. "45N")
 */
export function calculateUtmZone(lat: number, lon: number): string {
  let zoneNum = Math.floor((lon + 180) / 6) + 1;
  if (zoneNum > 60) zoneNum = 1;
  if (zoneNum < 1) zoneNum = 60;

  // Norway / Svalbard exceptions
  if (lat >= 56.0 && lat < 64.0 && lon >= 3.0 && lon < 12.0) {
    zoneNum = 32;
  } else if (lat >= 72.0 && lat < 84.0) {
    if (lon >= 0.0 && lon < 9.0) zoneNum = 31;
    else if (lon >= 9.0 && lon < 21.0) zoneNum = 33;
    else if (lon >= 21.0 && lon < 33.0) zoneNum = 35;
    else if (lon >= 33.0 && lon < 42.0) zoneNum = 37;
  }

  const hemi = lat >= 0 ? 'N' : 'S';
  return `${zoneNum}${hemi}`;
}

export const CoordinateBar: React.FC = () => {
  const [coords, setCoords] = useState<{ lat: number; lon: number }>(() => {
    const map = olService.getMap();
    if (map) {
      const center = map.getView().getCenter();
      if (center) {
        const [lon, lat] = toLonLat(center);
        return { lat, lon };
      }
    }
    return { lat: 13.082700, lon: 80.270700 }; // Chennai default fallback
  });

  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let rafId: number | null = null;
    let cleanupListeners: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const setupMapListeners = (map: Map) => {
      // Initialize coordinates with current view center if available
      const center = map.getView().getCenter();
      if (center) {
        const [lon, lat] = toLonLat(center);
        setCoords({ lat, lon });
      }

      const handlePointerMove = (evt: any) => {
        if (!evt.coordinate) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          const [lon, lat] = toLonLat(evt.coordinate);
          setCoords({ lat, lon });
        });
      };

      map.on('pointermove', handlePointerMove);

      return () => {
        map.un('pointermove', handlePointerMove);
        if (rafId) cancelAnimationFrame(rafId);
      };
    };

    const currentMap = olService.getMap();
    if (currentMap) {
      cleanupListeners = setupMapListeners(currentMap);
    } else {
      pollTimer = setInterval(() => {
        const m = olService.getMap();
        if (m) {
          if (pollTimer) clearInterval(pollTimer);
          cleanupListeners = setupMapListeners(m);
        }
      }, 100);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupListeners) cleanupListeners();
    };
  }, []);

  const handleCopy = useCallback(() => {
    const text = `${coords.lat.toFixed(6)}, ${coords.lon.toFixed(6)}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 1500);
    }).catch(() => {});
  }, [coords]);

  const latFormatted = coords.lat.toFixed(6);
  const lonFormatted = coords.lon.toFixed(6);
  const zoneFormatted = calculateUtmZone(coords.lat, coords.lon);

  return (
    <div
      className="hud-coord-bar"
      onClick={handleCopy}
      title={copied ? "Copied to clipboard!" : "Click to copy coordinates"}
      role="status"
      aria-live="polite"
    >
      <span className="hud-coord-icon" aria-hidden="true">
        <IconCoordinateTarget width={16} height={16} />
      </span>
      <span className="hud-coord-item">
        <span className="hud-coord-label">Lat:</span>
        <span className="hud-coord-value">{latFormatted}</span>
      </span>
      <span className="hud-coord-divider">•</span>
      <span className="hud-coord-item">
        <span className="hud-coord-label">Lon:</span>
        <span className="hud-coord-value">{lonFormatted}</span>
      </span>
      <span className="hud-coord-divider">•</span>
      <span className="hud-coord-item">
        <span className="hud-coord-label">Zone:</span>
        <span className="hud-coord-value hud-coord-zone">{zoneFormatted}</span>
      </span>
      {copied && <span className="hud-coord-copied-badge">Copied!</span>}
    </div>
  );
};

export default CoordinateBar;
