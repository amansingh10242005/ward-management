/// <reference types="vite/client" />
/**
 * openlayers.ts — OpenLayers service/hook module.
 *
 * Responsibilities:
 *  - Initialize the OpenLayers Map instance
 *  - Manage WMS / WFS layer sources (connecting to GeoServer)
 *  - Manage interactions (Draw, Modify, Select, Translate)
 *  - Keep OL objects strictly separated from React component state
 *  - Apply conditional glow styles to selected features
 */

import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';

export type BasemapId =
  | 'arcgis_satellite'
  | 'sentinel_satellite'
  | 'osm'
  | 'carto_dark'
  | 'arcgis_topo'
  | 'carto_voyager'
  | 'none';
import Draw from 'ol/interaction/Draw';
import GeoJSON from 'ol/format/GeoJSON';
import { Interaction } from 'ol/interaction';
import Select from 'ol/interaction/Select';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Snap from 'ol/interaction/Snap';

import Style from 'ol/style/Style';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { fromLonLat } from 'ol/proj';
import Collection from 'ol/Collection';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { altKeyOnly, singleClick } from 'ol/events/condition';
import { parseFeatureId } from '../utils/featureUtils';

const GEOSERVER_URL = import.meta.env.VITE_GEOSERVER_BASE_URL;
const WORKSPACE = import.meta.env.VITE_GEOSERVER_WORKSPACE;

// ── Color palette (matches CSS tokens) ─────────────────────────────────────
const COLORS = {
  streetlight: '#F5B84B',
  road:        '#19B5E6',
  zone:        '#38BDF8',
};



// ── Style factories ─────────────────────────────────────────────────────────

/** Invisible transparent style for hit-detection WFS layers (default) */
const transparentPointStyle = new Style({
  image: new CircleStyle({
    radius: 10,
    fill:   new Fill({ color: 'rgba(0,0,0,0)' }),
    stroke: new Stroke({ color: 'rgba(0,0,0,0)', width: 1 }),
  }),
});
const transparentLineStyle = new Style({
  stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 10 }),
});


/** Neon glow style for a selected zone polygon */
function makeZoneSelectedStyle(): Style[] {
  return [
    // Outer glow layer (wide, semi-transparent)
    new Style({
      fill:   new Fill({ color: 'rgba(56,189,248,0.12)' }),
      stroke: new Stroke({
        color: 'rgba(56,189,248,0.35)',
        width: 14,
      }),
    }),
    // Mid glow
    new Style({
      stroke: new Stroke({
        color: 'rgba(56,189,248,0.60)',
        width: 6,
      }),
    }),
    // Bright inner stroke
    new Style({
      stroke: new Stroke({
        color: '#38BDF8',
        width: 2.5,
      }),
    }),
  ];
}

/** Neon glow style for a selected road line */
function makeRoadSelectedStyle(): Style[] {
  return [
    new Style({
      stroke: new Stroke({
        color: 'rgba(25,181,230,0.30)',
        width: 14,
      }),
    }),
    new Style({
      stroke: new Stroke({
        color: 'rgba(25,181,230,0.60)',
        width: 6,
      }),
    }),
    new Style({
      stroke: new Stroke({
        color: '#19B5E6',
        width: 2.5,
      }),
    }),
  ];
}

/** Neon glow style for a selected streetlight point */
function makeStreetlightSelectedStyle(): Style[] {
  return [
    // Outer glow ring
    new Style({
      image: new CircleStyle({
        radius: 16,
        fill:   new Fill({ color: 'rgba(245,184,75,0.15)' }),
        stroke: new Stroke({ color: 'rgba(245,184,75,0.40)', width: 6 }),
      }),
    }),
    // Bright inner circle
    new Style({
      image: new CircleStyle({
        radius: 7,
        fill:   new Fill({ color: COLORS.streetlight }),
        stroke: new Stroke({ color: '#fff', width: 1.5 }),
      }),
    }),
  ];
}

/** Flatten geometry coordinates for extracting all vertex positions */
function getCoordinatesFlat(geom: any): number[][] {
  if (!geom) return [];
  const type = geom.getType();
  if (type === 'LineString') {
    return geom.getCoordinates();
  } else if (type === 'Polygon') {
    const rings = geom.getCoordinates();
    return rings[0] || [];
  } else if (type === 'MultiLineString') {
    return geom.getCoordinates().flat();
  } else if (type === 'MultiPolygon') {
    const polys = geom.getCoordinates();
    return polys.flatMap((poly: any) => poly[0] || []);
  } else if (type === 'Point') {
    return [geom.getCoordinates()];
  }
  return [];
}

export interface PerfMetrics {
  wmsTileLoads: number;
  wmsTileErrors: number;
  searchRequests: number;
  lastSearchDurationMs: number;
  lastSearchPayloadBytes: number;
  lastSearchFeatureCount: number;
  lastPanDurationMs: number;
  lastZoomDurationMs: number;
  lastPanTimestamp: number;
}

// ── Service class ─────────────────────────────────────────────────────────────

export class OpenLayersService {
  private map: Map | null = null;
  private layers: Record<string, TileLayer<TileWMS>> = {};

  private perfMetrics: PerfMetrics = {
    wmsTileLoads: 0,
    wmsTileErrors: 0,
    searchRequests: 0,
    lastSearchDurationMs: 0,
    lastSearchPayloadBytes: 0,
    lastSearchFeatureCount: 0,
    lastPanDurationMs: 0,
    lastZoomDurationMs: 0,
    lastPanTimestamp: 0,
  };

  getPerfMetrics(): PerfMetrics {
    return { ...this.perfMetrics };
  }

  resetPerfMetrics() {
    this.perfMetrics = {
      wmsTileLoads: 0,
      wmsTileErrors: 0,
      searchRequests: 0,
      lastSearchDurationMs: 0,
      lastSearchPayloadBytes: 0,
      lastSearchFeatureCount: 0,
      lastPanDurationMs: 0,
      lastZoomDurationMs: 0,
      lastPanTimestamp: 0,
    };
  }

  private drawSource = new VectorSource();
  private drawLayer  = new VectorLayer({
    source:  this.drawSource,
    zIndex:  999,
  });

  // Track currently selected feature for style functions
  private selectedLayerName: string | null = null;
  private selectedFeatureId:  string | number | null = null;

  // ── WFS sources ────────────────────────────────────────────────────────────

  private streetlightsWfsSource = new VectorSource({
    format: new GeoJSON({ dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }),
    url: (extent) =>
      `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:streetlights&outputFormat=application/json&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
    strategy: bboxStrategy,
  });

  private roadsWfsSource = new VectorSource({
    format: new GeoJSON({ dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }),
    url: (extent) =>
      `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:roads&outputFormat=application/json&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
    strategy: bboxStrategy,
  });

  private zonesWfsSource = new VectorSource({
    format: new GeoJSON({ dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }),
    url: (extent) =>
      `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:zones&outputFormat=application/json&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
    strategy: bboxStrategy,
  });

  private statesWfsSource = new VectorSource({
    format: new GeoJSON({ dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }),
    url: (extent) =>
      `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:states&outputFormat=application/json&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
    strategy: bboxStrategy,
  });

  private districtsWfsSource = new VectorSource({
    format: new GeoJSON({ dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }),
    url: (extent) =>
      `${GEOSERVER_URL}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:districts&outputFormat=application/json&srsname=EPSG:3857&bbox=${extent.join(',')},EPSG:3857`,
    strategy: bboxStrategy,
  });

  // ── WFS vector layers with conditional style functions ────────────────────

  private hiddenFeatureIds: Record<string, Set<string>> = {
    streetlights: new Set(),
    roads: new Set(),
    zones: new Set(),
    states: new Set(),
    districts: new Set(),
  };

  private streetlightsWfsLayer = new VectorLayer({
    source: this.streetlightsWfsSource,
    maxResolution: 80, // Active at street/neighborhood scale (zoom >= 11; default zoom 12 is ~38.2 m/px)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.streetlights?.has(rawId)) {
        return new Style({});
      }
      if (
        this.selectedLayerName === 'streetlights' &&
        this.selectedFeatureId !== null &&
        feature.getId() === this.selectedFeatureId
      ) {
        return makeStreetlightSelectedStyle();
      }
      return transparentPointStyle;
    },
    zIndex: 900,
  });

  private roadsWfsLayer = new VectorLayer({
    source: this.roadsWfsSource,
    maxResolution: 300, // Active at ward/neighborhood scale (zoom >= 9)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.roads?.has(rawId)) {
        return new Style({});
      }
      if (
        this.selectedLayerName === 'roads' &&
        this.selectedFeatureId !== null &&
        feature.getId() === this.selectedFeatureId
      ) {
        return makeRoadSelectedStyle();
      }
      return transparentLineStyle;
    },
    zIndex: 900,
  });

  private zonesWfsLayer = new VectorLayer({
    source: this.zonesWfsSource,
    maxResolution: 1250, // Active at city/zone scale (zoom >= 7)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.zones?.has(rawId)) {
        return new Style({});
      }
      const name = feature.get('name');
      const textStyle = name ? new Text({
        text: name,
        font: '600 14px "Inter", sans-serif',
        fill: new Fill({ color: '#ecfdf5' }),
        stroke: new Stroke({ color: '#047857', width: 4 }),
        textAlign: 'center',
        textBaseline: 'middle',
        overflow: true,
      }) : undefined;

      const isSelected = this.selectedLayerName === 'zones' &&
                         this.selectedFeatureId !== null &&
                         feature.getId() === this.selectedFeatureId;

      if (isSelected) {
        const styles = makeZoneSelectedStyle();
        if (textStyle) {
          styles.push(new Style({ text: textStyle }));
        }
        return styles;
      }
      return new Style({
        fill:   new Fill({ color: 'rgba(255,255,255,0.01)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 2 }),
        text: textStyle,
      });
    },
    zIndex: 900,
  });

  private statesWfsLayer = new VectorLayer({
    source: this.statesWfsSource,
    maxResolution: 20000, // Active at subcontinental scale (zoom >= 3)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.states?.has(rawId)) {
        return new Style({});
      }
      const name = feature.get('STATE') || feature.get('state');
      const textStyle = name ? new Text({
        text: name,
        font: '700 16px "Inter", sans-serif',
        fill: new Fill({ color: '#f8fafc' }),
        stroke: new Stroke({ color: '#475569', width: 4 }),
        textAlign: 'center',
        textBaseline: 'middle',
        overflow: true,
      }) : undefined;

      const isSelected = this.selectedLayerName === 'states' &&
                         this.selectedFeatureId !== null &&
                         feature.getId() === this.selectedFeatureId;

      if (isSelected) {
        return new Style({
          fill:   new Fill({ color: 'rgba(244,63,94,0.08)' }),
          stroke: new Stroke({ color: 'rgba(244,63,94,0.60)', width: 6 }),
          text: textStyle,
        });
      }
      return new Style({
        fill:   new Fill({ color: 'rgba(255,255,255,0.0)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 2 }),
        text: textStyle,
      });
    },
    zIndex: 880,
    visible: true,
  });

  private districtsWfsLayer = new VectorLayer({
    source: this.districtsWfsSource,
    maxResolution: 2500, // Active at regional/district scale (zoom >= 6; prevents 152 MB payload at world zoom)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.districts?.has(rawId)) {
        return new Style({});
      }
      const name = feature.get('District') || feature.get('district');
      const textStyle = name ? new Text({
        text: name,
        font: '600 14px "Inter", sans-serif',
        fill: new Fill({ color: '#f1f5f9' }),
        stroke: new Stroke({ color: '#64748b', width: 4 }),
        textAlign: 'center',
        textBaseline: 'middle',
        overflow: true,
      }) : undefined;

      const isSelected = this.selectedLayerName === 'districts' &&
                         this.selectedFeatureId !== null &&
                         feature.getId() === this.selectedFeatureId;

      if (isSelected) {
        return new Style({
          fill:   new Fill({ color: 'rgba(168,85,247,0.08)' }),
          stroke: new Stroke({ color: 'rgba(168,85,247,0.60)', width: 6 }),
          text: textStyle,
        });
      }
      return new Style({
        fill:   new Fill({ color: 'rgba(255,255,255,0.0)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 2 }),
        text: textStyle,
      });
    },
    zIndex: 890,
    visible: true,
  });

  private activeInteractions: Interaction[] = [];
  private rotationListeners: ((rotation: number) => void)[] = [];
  private moveEndListeners: (() => void)[] = [];
  private layerRefreshListeners: ((layerName: string) => void)[] = [];

  private basemapLayer: TileLayer<any> | null = null;
  private currentBasemap: BasemapId = 'carto_dark';
  private basemapChangeListeners: ((id: BasemapId) => void)[] = [];

  // ── Vertex editing state ──────────────────────────────────────────────────
  private vertexEditFeature: Feature | null = null;
  private vertexEditOriginalGeometry: any = null;
  private selectedVertexCoord: number[] | null = null;
  private vertexEditKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private vertexEditMapClickListener: ((e: any) => void) | null = null;
  private onVertexEditGeometryChange: ((geoJson: any) => void) | null = null;
  private onVertexEditCancelCallback: (() => void) | null = null;
  private savedSelectCallback: ((feature: any, layerName: string) => void) | null = null;

  private createBasemapSource(id: BasemapId) {
    switch (id) {
      case 'arcgis_satellite':
        return new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19,
          crossOrigin: 'anonymous',
        });
      case 'sentinel_satellite':
        return new XYZ({
          url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
          maxZoom: 18,
          crossOrigin: 'anonymous',
        });
      case 'osm':
        return new OSM({
          crossOrigin: 'anonymous',
        });
      case 'carto_dark':
        // High-contrast dark basemap using OSM with custom hue-matched dark filter (no watermarks / no API key)
        return new OSM({
          crossOrigin: 'anonymous',
        });
      case 'arcgis_topo':
        return new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19,
          crossOrigin: 'anonymous',
        });
      case 'carto_voyager':
        // Detailed street basemap using Esri World Street Map (no watermarks / no API key)
        return new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
          maxZoom: 19,
          crossOrigin: 'anonymous',
        });
      case 'none':
      default:
        return null;
    }
  }

  setBasemap(id: BasemapId) {
    this.currentBasemap = id;
    if (!this.map || !this.basemapLayer) return;

    if (id === 'none') {
      this.basemapLayer.setVisible(false);
    } else {
      const source = this.createBasemapSource(id);
      if (source) {
        const newLayer = new TileLayer({
          source,
          className: id === 'carto_dark' ? 'dark-osm-basemap' : '',
          zIndex: 0,
        });
        const layers = this.map.getLayers();
        const idx = layers.getArray().indexOf(this.basemapLayer);
        if (idx !== -1) {
          layers.setAt(idx, newLayer);
        } else {
          layers.insertAt(0, newLayer);
        }
        this.basemapLayer = newLayer;
      }
    }
    this.basemapChangeListeners.forEach((l) => l(id));
  }

  getBasemap(): BasemapId {
    return this.currentBasemap;
  }

  onBasemapChange(listener: (id: BasemapId) => void) {
    this.basemapChangeListeners.push(listener);
    listener(this.currentBasemap);
    return () => {
      this.basemapChangeListeners = this.basemapChangeListeners.filter((l) => l !== listener);
    };
  }

  onRotationChange(listener: (rotation: number) => void) {
    this.rotationListeners.push(listener);
    if (this.map) listener(this.map.getView().getRotation());
    return () => {
      this.rotationListeners = this.rotationListeners.filter(l => l !== listener);
    };
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  initialize(target: HTMLElement | string) {
    if (this.map) return; // Prevent double initialization

    this.layers = {
      zones: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:zones`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
        }),
        visible: true,
      }),
      states: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:states`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
        }),
        visible: true,
      }),
      districts: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:districts`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
        }),
        visible: true,
      }),
      roads: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:roads`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
        }),
        visible: true,
      }),
      streetlights: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:streetlights`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
          transition: 0,
        }),
        visible: true,
      }),
    };

    // Initialize basemap layer
    const initialSource = this.createBasemapSource(this.currentBasemap);
    this.basemapLayer = new TileLayer({
      source: initialSource || undefined,
      className: this.currentBasemap === 'carto_dark' ? 'dark-osm-basemap' : '',
      zIndex: 0,
    });

    this.map = new Map({
      target,
      controls: [], // Remove default OL controls (we use custom ones in React)
      layers: [
        this.basemapLayer,
        this.layers.states,
        this.layers.districts,
        this.layers.zones,
        this.layers.roads,
        this.layers.streetlights,
        this.statesWfsLayer,
        this.districtsWfsLayer,
        this.zonesWfsLayer,
        this.roadsWfsLayer,
        this.streetlightsWfsLayer,
        this.drawLayer,
      ],
      view: new View({
        center: fromLonLat([80.2707, 13.0827]), // Chennai
        zoom:   12,
      }),
    });

    this.map.getView().on('change:rotation', () => {
      const rot = this.map!.getView().getRotation();
      this.rotationListeners.forEach(l => l(rot));
    });

    // Change cursor to pointer (hand) when hovering over interactive features
    this.map.on('pointermove', (e) => {
      if (this.map!.hasFeatureAtPixel(e.pixel, { hitTolerance: 5 })) {
        this.map!.getTargetElement().style.cursor = 'pointer';
      } else {
        this.map!.getTargetElement().style.cursor = '';
      }
    });

    // Performance instrumentation: track WMS tile events
    Object.values(this.layers).forEach((tileLayer) => {
      const src = tileLayer.getSource();
      if (src) {
        src.on('tileloadend', () => {
          this.perfMetrics.wmsTileLoads++;
        });
        src.on('tileloaderror', () => {
          this.perfMetrics.wmsTileErrors++;
        });
      }
    });

    let lastCenter = this.map.getView().getCenter();
    let lastResolution = this.map.getView().getResolution();
    let moveStartTime = 0;

    this.map.on('movestart', () => {
      moveStartTime = performance.now();
    });

    this.map.on('moveend', () => {
      const duration = moveStartTime > 0 ? Math.round(performance.now() - moveStartTime) : 0;
      const currentCenter = this.map!.getView().getCenter();
      const currentResolution = this.map!.getView().getResolution();

      if (lastResolution !== currentResolution) {
        this.perfMetrics.lastZoomDurationMs = duration;
        lastResolution = currentResolution;
      } else if (lastCenter && currentCenter && (lastCenter[0] !== currentCenter[0] || lastCenter[1] !== currentCenter[1])) {
        this.perfMetrics.lastPanDurationMs = duration;
        this.perfMetrics.lastPanTimestamp = Date.now();
        lastCenter = currentCenter;
      }

      this.moveEndListeners.forEach(l => l());
    });

    // Expose performance metrics globally for benchmarking and diagnostics
    if (typeof window !== 'undefined') {
      (window as any).__WIM_PERF__ = {
        getMetrics: () => this.getPerfMetrics(),
        reset: () => this.resetPerfMetrics(),
      };
    }
  }

  getMap(): Map | null {
    return this.map;
  }

  // ── Selected feature glow ────────────────────────────────────────────────────

  /**
   * Tell the WFS vector layers which feature is selected so their style
   * functions can apply the neon glow. Pass (null, null) to clear selection.
   */
  setSelectedFeature(layerName: string | null, featureId: string | number | null, fallbackGeoJson?: any) {
    this.selectedLayerName  = layerName;
    this.selectedFeatureId  = featureId;

    if (layerName && featureId && fallbackGeoJson) {
      this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, fallbackGeoJson);
    }

    // Re-render all WFS layers to apply new styles
    this.refreshWfsLayerStyles();
  }

  refreshWfsLayerStyles() {
    this.streetlightsWfsLayer.changed();
    this.roadsWfsLayer.changed();
    this.zonesWfsLayer.changed();
    this.statesWfsLayer.changed();
    this.districtsWfsLayer.changed();
  }

  getFeatureProperties(layerName: string, rawId: number | string): any | null {
    let source;
    if (layerName === 'zones') source = this.zonesWfsSource;
    else if (layerName === 'roads') source = this.roadsWfsSource;
    else if (layerName === 'streetlights') source = this.streetlightsWfsSource;
    else if (layerName === 'states') source = this.statesWfsSource;
    else if (layerName === 'districts') source = this.districtsWfsSource;
    
    if (!source) return null;

    // In GeoServer WFS, the feature ID is usually prefixed with the workspace/layer name (e.g. 'zones.1')
    // OpenLayers handles this as the string ID.
    const feature = source.getFeatureById(`${layerName}.${rawId}`);
    if (feature) {
      return feature.getProperties();
    }
    return null;
  }

  async searchFeaturesFromBackend(
    layerName: string,
    search: string = '',
    signal?: AbortSignal
  ): Promise<any[]> {
    if (!this.map) return [];
    
    let cqlFilter = '';
    if (search.trim()) {
      const searchStr = search.replace(/'/g, "''");
      switch (layerName) {
        case 'states':
          cqlFilter = `state ILIKE '%${searchStr}%'`;
          break;
        case 'districts':
          cqlFilter = `district ILIKE '%${searchStr}%' OR state ILIKE '%${searchStr}%'`;
          break;
        case 'zones':
          cqlFilter = `name ILIKE '%${searchStr}%'`;
          break;
        case 'roads':
          cqlFilter = `name ILIKE '%${searchStr}%'`;
          break;
        case 'streetlights':
          cqlFilter = `name ILIKE '%${searchStr}%'`;
          break;
      }
    }

    // Property projection based on layer to avoid fetching multi-megabyte geometries for feature listing/search
    let propertyNames = '';
    switch (layerName) {
      case 'states':
        propertyNames = 'id,state,state_lgd';
        break;
      case 'districts':
        propertyNames = 'id,district,district_l,state';
        break;
      case 'zones':
        propertyNames = 'id,name,type';
        break;
      case 'roads':
        propertyNames = 'id,name,category,zone_id';
        break;
      case 'streetlights':
        propertyNames = 'id,name,type,zone_id,road_id';
        break;
    }

    const baseUrl = GEOSERVER_URL.startsWith('http') ? GEOSERVER_URL : window.location.origin + GEOSERVER_URL;
    const url = new URL(`${baseUrl}/${WORKSPACE}/ows`);
    url.searchParams.append('service', 'WFS');
    url.searchParams.append('version', '1.1.0');
    url.searchParams.append('request', 'GetFeature');
    url.searchParams.append('typeName', `${WORKSPACE}:${layerName}`);
    url.searchParams.append('outputFormat', 'application/json');
    url.searchParams.append('srsname', 'EPSG:3857');
    url.searchParams.append('maxFeatures', '100');
    if (propertyNames) {
      url.searchParams.append('propertyName', propertyNames);
    }
    if (cqlFilter) {
      url.searchParams.append('cql_filter', cqlFilter);
    }

    const startTime = performance.now();
    try {
      const res = await fetch(url.toString(), { signal });
      if (!res.ok) return [];
      const text = await res.text();
      const duration = performance.now() - startTime;
      const payloadBytes = new Blob([text]).size;
      const data = JSON.parse(text);
      const features = data.features || [];

      // Record performance metrics
      this.perfMetrics.searchRequests++;
      this.perfMetrics.lastSearchDurationMs = Math.round(duration);
      this.perfMetrics.lastSearchPayloadBytes = payloadBytes;
      this.perfMetrics.lastSearchFeatureCount = features.length;

      return features;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Request cancelled by newer search
        return [];
      }
      console.error('Failed to search features from backend', err);
      return [];
    }
  }

  onLayerRefresh(listener: (layerName: string) => void) {
    this.layerRefreshListeners.push(listener);
    return () => {
      this.layerRefreshListeners = this.layerRefreshListeners.filter(l => l !== listener);
    };
  }

  onMoveEnd(listener: () => void) {
    this.moveEndListeners.push(listener);
    return () => {
      this.moveEndListeners = this.moveEndListeners.filter(l => l !== listener);
    };
  }

  getWfsFeature(layerName: string, featureId: string | number): Feature | null {
    let source: VectorSource | null = null;
    if (layerName === 'zones') source = this.zonesWfsSource;
    else if (layerName === 'roads') source = this.roadsWfsSource;
    else if (layerName === 'streetlights') source = this.streetlightsWfsSource;
    else if (layerName === 'states') source = this.statesWfsSource;
    else if (layerName === 'districts') source = this.districtsWfsSource;

    if (!source) return null;

    // 1. Direct ID
    let feat = source.getFeatureById(featureId);
    if (feat) return feat as Feature;

    // 2. Prefixed ID
    const prefixedId = `${layerName}.${featureId}`;
    feat = source.getFeatureById(prefixedId);
    if (feat) return feat as Feature;

    // 3. Raw parsed numeric ID
    const rawId = parseFeatureId(featureId);
    if (rawId !== null) {
      feat = source.getFeatureById(rawId) || source.getFeatureById(`${layerName}.${rawId}`);
      if (feat) return feat as Feature;
    }

    // 4. Search existing loaded features
    const all = source.getFeatures();
    for (const f of all) {
      const fid = f.getId();
      if (fid === featureId || fid === prefixedId) return f as Feature;
      if (rawId !== null && (fid === rawId || parseFeatureId(fid) === rawId)) return f as Feature;
    }

    return null;
  }

  addOrUpdateWfsFeatureFromGeoJson(
    layerName: string,
    featureId: string | number,
    geoJson: any
  ): Feature | null {
    let source: VectorSource | null = null;
    if (layerName === 'zones') source = this.zonesWfsSource;
    else if (layerName === 'roads') source = this.roadsWfsSource;
    else if (layerName === 'streetlights') source = this.streetlightsWfsSource;
    else if (layerName === 'states') source = this.statesWfsSource;
    else if (layerName === 'districts') source = this.districtsWfsSource;

    if (!source || !geoJson) return null;

    const geomData = geoJson.geometry || (geoJson.type && geoJson.coordinates ? geoJson : null);
    if (!geomData || !geomData.coordinates) return null;

    try {
      const coords = geomData.coordinates;
      let is3857 = false;
      if (coords && coords.length > 0) {
        const firstPt = Array.isArray(coords[0])
          ? (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0])
          : coords;
        if (Array.isArray(firstPt) && (Math.abs(firstPt[0]) > 180 || Math.abs(firstPt[1]) > 90)) {
          is3857 = true;
        }
      }

      const featureObj = geoJson.type === 'Feature' ? geoJson : {
        type: 'Feature',
        id: featureId,
        geometry: geomData,
        properties: geoJson.properties || {},
      };

      const feature = new GeoJSON().readFeature(featureObj, {
        dataProjection: is3857 ? 'EPSG:3857' : 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      }) as Feature;

      const fid = feature.getId() || featureId;
      feature.setId(fid);

      const existing = source.getFeatureById(fid) || source.getFeatureById(`${layerName}.${fid}`);
      if (existing) {
        const newGeom = feature.getGeometry();
        if (newGeom) existing.setGeometry(newGeom);
        return existing as Feature;
      } else {
        source.addFeature(feature);
        return feature;
      }
    } catch (err) {
      console.warn('Failed to add WFS feature from GeoJSON:', err);
      return null;
    }
  }

  async centerOnFeature(layerName: string, featureId: string | number, fallbackGeoJson?: any) {
    if (!this.map) return;
    let feature = this.getWfsFeature(layerName, featureId);
    if ((!feature || !feature.getGeometry()) && fallbackGeoJson && fallbackGeoJson.geometry) {
      feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, fallbackGeoJson);
    }

    // If feature geometry is not yet present (e.g. from property-projected search list),
    // fetch the single feature's full geometry from GeoServer on demand
    if (!feature || !feature.getGeometry()) {
      try {
        const rawId = parseFeatureId(featureId) ?? featureId;
        const fidParam = String(rawId).includes('.') ? rawId : `${layerName}.${rawId}`;
        const baseUrl = GEOSERVER_URL.startsWith('http') ? GEOSERVER_URL : window.location.origin + GEOSERVER_URL;
        const res = await fetch(
          `${baseUrl}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${layerName}&outputFormat=application/json&srsname=EPSG:3857&featureID=${fidParam}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.features && data.features.length > 0) {
            feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, data.features[0]);
            this.refreshWfsLayerStyles();
          }
        }
      } catch (e) {
        console.warn('Failed to fetch full geometry for centerOnFeature:', e);
      }
    }

    if (feature) {
      const geometry = feature.getGeometry();
      if (geometry) {
        if (geometry.getType() === 'Point') {
          this.map.getView().animate({
            center: (geometry as Point).getCoordinates(),
            zoom: 18,
            duration: 600,
          });
        } else {
          this.map.getView().fit(geometry.getExtent(), {
            padding: [60, 60, 60, 60],
            maxZoom: 16,
            duration: 600,
          });
        }
        return;
      }
    }

    const geomData = fallbackGeoJson?.geometry || fallbackGeoJson;
    if (geomData && geomData.type && geomData.coordinates) {
      try {
        const coords = geomData.coordinates;
        let is3857 = false;
        if (coords && coords.length > 0) {
          const firstPt = Array.isArray(coords[0])
            ? (Array.isArray(coords[0][0]) ? coords[0][0] : coords[0])
            : coords;
          if (Array.isArray(firstPt) && (Math.abs(firstPt[0]) > 180 || Math.abs(firstPt[1]) > 90)) {
            is3857 = true;
          }
        }
        const geom = new GeoJSON().readGeometry(geomData, {
          dataProjection: is3857 ? 'EPSG:3857' : 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        if (geom) {
          if (geom.getType() === 'Point') {
            this.map.getView().animate({
              center: (geom as Point).getCoordinates(),
              zoom: 18,
              duration: 600,
            });
          } else {
            this.map.getView().fit(geom.getExtent(), {
              padding: [60, 60, 60, 60],
              maxZoom: 16,
              duration: 600,
            });
          }
        }
      } catch (err) {
        console.warn('Failed to parse geometry for centerOnFeature fallback:', err);
      }
    }
  }

  // ── Layer management ─────────────────────────────────────────────────────────

  toggleLayer(layerName: string, visible: boolean) {
    if (this.layers[layerName]) {
      this.layers[layerName].setVisible(visible);
    }
    // Also toggle WFS layers
    if (layerName === 'zones') this.zonesWfsLayer.setVisible(visible);
    if (layerName === 'roads') this.roadsWfsLayer.setVisible(visible);
    if (layerName === 'streetlights') this.streetlightsWfsLayer.setVisible(visible);
    if (layerName === 'states') this.statesWfsLayer.setVisible(visible);
    if (layerName === 'districts') this.districtsWfsLayer.setVisible(visible);
  }

  isFeatureVisible(layerName: string, featureId: string | number): boolean {
    const rawId = String(parseFeatureId(featureId) ?? featureId);
    return !this.hiddenFeatureIds[layerName]?.has(rawId);
  }

  getHiddenFeatureIds(layerName: string): string[] {
    return Array.from(this.hiddenFeatureIds[layerName] || []);
  }

  toggleFeatureVisibility(layerName: string, featureId: string | number): boolean {
    if (!this.hiddenFeatureIds[layerName]) {
      this.hiddenFeatureIds[layerName] = new Set();
    }
    const rawId = String(parseFeatureId(featureId) ?? featureId);
    const set = this.hiddenFeatureIds[layerName];
    let isNowVisible = false;
    if (set.has(rawId)) {
      set.delete(rawId);
      isNowVisible = true;
    } else {
      set.add(rawId);
      isNowVisible = false;
    }

    // Refresh vector layer to update visibility styling
    if (layerName === 'streetlights') this.streetlightsWfsLayer.changed();
    else if (layerName === 'roads') this.roadsWfsLayer.changed();
    else if (layerName === 'zones') this.zonesWfsLayer.changed();
    else if (layerName === 'states') this.statesWfsLayer.changed();
    else if (layerName === 'districts') this.districtsWfsLayer.changed();

    // Refresh WMS layer with valid GeoServer CQL_FILTER
    if (this.layers[layerName]) {
      const hiddenArray = Array.from(set);
      const formattedList = hiddenArray.map((id) => {
        const num = Number(id);
        return !isNaN(num) ? num : `'${String(id).replace(/'/g, "''")}'`;
      });

      const cqlFilter = formattedList.length > 0 ? `NOT (id IN (${formattedList.join(',')}))` : undefined;
      const source = this.layers[layerName].getSource();
      if (source) {
        const params = { ...source.getParams() };
        if (cqlFilter) {
          source.updateParams({ ...params, CQL_FILTER: cqlFilter, _ts: Date.now() });
        } else {
          delete params.CQL_FILTER;
          source.updateParams({ ...params, CQL_FILTER: null, _ts: Date.now() });
        }
        source.refresh();
      }
      this.layers[layerName].changed();
    }

    return isNowVisible;
  }

  refreshWmsLayer(layerName: string) {
    if (this.layers[layerName]) {
      const source = this.layers[layerName].getSource();
      if (source) {
        source.updateParams({ _ts: Date.now() });
        source.refresh();
      }
      this.layers[layerName].changed();
    }
  }

  refreshLayer(layerName: string) {
    this.refreshWmsLayer(layerName);
    if (layerName === 'streetlights') this.streetlightsWfsSource.refresh();
    else if (layerName === 'roads')   this.roadsWfsSource.refresh();
    else if (layerName === 'zones')   this.zonesWfsSource.refresh();
    else if (layerName === 'states')  this.statesWfsSource.refresh();
    else if (layerName === 'districts') this.districtsWfsSource.refresh();
    this.layerRefreshListeners.forEach(l => l(layerName));
  }

  removeWFSFeature(layerName: string, featureId: string | number) {
    if (layerName === 'streetlights') {
      const f = this.streetlightsWfsSource.getFeatureById(featureId);
      if (f) this.streetlightsWfsSource.removeFeature(f);
    } else if (layerName === 'roads') {
      const f = this.roadsWfsSource.getFeatureById(featureId);
      if (f) this.roadsWfsSource.removeFeature(f);
    } else if (layerName === 'zones') {
      const f = this.zonesWfsSource.getFeatureById(featureId);
      if (f) this.zonesWfsSource.removeFeature(f);
    } else if (layerName === 'states') {
      const f = this.statesWfsSource.getFeatureById(featureId);
      if (f) this.statesWfsSource.removeFeature(f);
    } else if (layerName === 'districts') {
      const f = this.districtsWfsSource.getFeatureById(featureId);
      if (f) this.districtsWfsSource.removeFeature(f);
    }
  }

  // ── Interactions ──────────────────────────────────────────────────────────────

  private activateInteraction(interactions: Interaction | Interaction[] | null) {
    if (this.map) {
      this.activeInteractions.forEach(i => this.map!.removeInteraction(i));
    }
    if (!interactions) {
      this.activeInteractions = [];
    } else {
      this.activeInteractions = Array.isArray(interactions) ? interactions : [interactions];
    }
    if (this.map) {
      this.activeInteractions.forEach(i => this.map!.addInteraction(i));
    }
  }

  activateDraw(type: 'Point' | 'LineString' | 'Polygon', layerName: string, onDrawEnd: (feature: any) => void) {
    this.drawSource.clear();

    const layerColor =
      layerName === 'streetlights' ? COLORS.streetlight : layerName === 'roads' ? COLORS.road : COLORS.zone;

    this.drawLayer.setStyle(
      new Style({
        stroke: new Stroke({ color: layerColor, width: 3 }),
        fill:   new Fill({ color: `${layerColor}22` }),
        image:  new CircleStyle({
          radius: 5,
          fill:   new Fill({ color: layerColor }),
          stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
        }),
      })
    );

    const draw = new Draw({
      source: this.drawSource,
      type,
    });

    draw.on('drawend', (event) => {
      const geojsonFeature = new GeoJSON().writeFeatureObject(event.feature, {
        dataProjection:    'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      onDrawEnd(geojsonFeature);
      setTimeout(() => {
        if (this.map) {
          this.activeInteractions.forEach(i => this.map!.removeInteraction(i));
          this.activeInteractions = [];
        }
      }, 0);
    });

    const interactions: Interaction[] = [draw];
    if (layerName === 'streetlights') {
      interactions.push(new Snap({ source: this.roadsWfsSource }));
    }

    this.activateInteraction(interactions);
  }

  activateSelect(onSelect: (feature: any, layerName: string) => void) {
    this.savedSelectCallback = onSelect;
    const select = new Select({
      layers: [
        this.streetlightsWfsLayer,
        this.roadsWfsLayer,
        this.zonesWfsLayer,
        this.statesWfsLayer,
        this.districtsWfsLayer,
      ],
      hitTolerance: 6,
    });

    select.on('select', (event) => {
      const selectedFeature = event.selected[0];
      if (selectedFeature) {
        const geojsonFeature = new GeoJSON().writeFeatureObject(selectedFeature, {
          dataProjection:    'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });

        let layerName = 'streetlights';
        if (geojsonFeature.id && String(geojsonFeature.id).startsWith('roads')) layerName = 'roads';
        if (geojsonFeature.id && String(geojsonFeature.id).startsWith('zones')) layerName = 'zones';
        if (geojsonFeature.id && String(geojsonFeature.id).startsWith('states')) layerName = 'states';
        if (geojsonFeature.id && String(geojsonFeature.id).startsWith('districts')) layerName = 'districts';

        // Apply glow immediately on select
        this.setSelectedFeature(layerName, geojsonFeature.id ?? null);
        onSelect(geojsonFeature, layerName);
      } else {
        this.setSelectedFeature(null, null);
        onSelect(null, '');
      }
    });

    this.activateInteraction([select]);
  }

  activateModify(
    onSelect:    (feature: any, layerName: string) => void,
    _onModifyEnd?: (feature: any) => void,
  ) {
    // Retained for compatibility — pure selection during normal mode
    this.activateSelect(onSelect);
  }

  activateVertexEdit(
    layerName: string,
    featureId: string | number,
    initialGeoJson: any,
    onGeometryChange: (currentGeometry: any) => void,
    onCancel: () => void,
  ): boolean {
    if (!this.map) return false;

    // Clean up any existing vertex editing session first without triggering select interaction churn
    this.teardownVertexEditState();

    // 1. Locate the feature in WFS layer or construct it
    let feature = this.getWfsFeature(layerName, featureId);
    if (!feature && initialGeoJson) {
      feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, initialGeoJson);
    }

    if (!feature) {
      console.warn(`[VertexEdit] Feature ${featureId} not found in ${layerName}`);
      return false;
    }

    const geom = feature.getGeometry();
    if (!geom) return false;

    // 3. Store immutable clone of original geometry
    this.vertexEditFeature = feature;
    this.vertexEditOriginalGeometry = geom.clone();
    this.selectedVertexCoord = null;
    this.onVertexEditGeometryChange = onGeometryChange;
    this.onVertexEditCancelCallback = onCancel;

    const geomType = geom.getType();

    // 4. Point feature (Streetlights): Position Edit behavior
    if (geomType === 'Point') {
      const editCollection = new Collection([feature]);
      feature.setStyle(
        new Style({
          image: new CircleStyle({
            radius: 12,
            fill: new Fill({ color: 'rgba(245, 184, 75, 0.30)' }),
            stroke: new Stroke({ color: '#F5B84B', width: 3 }),
          }),
        })
      );

      const translate = new Translate({
        features: editCollection,
      });

      translate.on('translateend', () => {
        const curGeom = this.getVertexEditCurrentGeometry();
        if (curGeom && this.onVertexEditGeometryChange) {
          this.onVertexEditGeometryChange(curGeom);
        }
      });

      this.vertexEditKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelVertexEdit();
        }
      };
      window.addEventListener('keydown', this.vertexEditKeyHandler);

      this.activateInteraction([translate]);
      return true;
    }

    // 5. LineString or Polygon features: Full Vertex Editing
    const updateFeatureStyle = () => {
      if (!this.vertexEditFeature) return;
      const g = this.vertexEditFeature.getGeometry();
      if (!g) return;

      const styles: Style[] = [];

      // Base geometry styling
      if (geomType === 'LineString' || geomType === 'MultiLineString') {
        styles.push(
          new Style({
            stroke: new Stroke({ color: 'rgba(25, 181, 230, 0.25)', width: 10 }),
          }),
          new Style({
            stroke: new Stroke({ color: '#19B5E6', width: 3.5 }),
          })
        );
      } else {
        styles.push(
          new Style({
            fill: new Fill({ color: 'rgba(56, 189, 248, 0.16)' }),
            stroke: new Stroke({ color: 'rgba(56, 189, 248, 0.35)', width: 8 }),
          }),
          new Style({
            stroke: new Stroke({ color: '#38BDF8', width: 2.5 }),
          })
        );
      }

      // Existing vertices styling
      const coords = getCoordinatesFlat(g);
      for (const coord of coords) {
        const isSelected =
          this.selectedVertexCoord &&
          Math.abs(coord[0] - this.selectedVertexCoord[0]) < 1e-4 &&
          Math.abs(coord[1] - this.selectedVertexCoord[1]) < 1e-4;

        if (isSelected) {
          styles.push(
            new Style({
              geometry: new Point(coord),
              image: new CircleStyle({
                radius: 7,
                fill: new Fill({ color: '#f59e0b' }),
                stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
              }),
              zIndex: 1003,
            })
          );
        } else {
          styles.push(
            new Style({
              geometry: new Point(coord),
              image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color: '#ffffff' }),
                stroke: new Stroke({ color: '#0284c7', width: 2 }),
              }),
              zIndex: 1001,
            })
          );
        }
      }

      this.vertexEditFeature.setStyle(styles);
    };

    updateFeatureStyle();

    const editFeatures = new Collection([feature]);
    const modify = new Modify({
      features: editFeatures,
      deleteCondition: (event) => altKeyOnly(event) && singleClick(event),
      style: new Style({
        image: new CircleStyle({
          radius: 7.5,
          fill: new Fill({ color: '#f97316' }), // vibrant orange for new/dragged vertex
          stroke: new Stroke({ color: '#ffffff', width: 2 }),
        }),
        zIndex: 1005,
      }),
      pixelTolerance: 12,
    });

    modify.on('modifyend', () => {
      this.selectedVertexCoord = null;
      updateFeatureStyle();
      const current = this.getVertexEditCurrentGeometry();
      if (current && this.onVertexEditGeometryChange) {
        this.onVertexEditGeometryChange(current);
      }
    });

    // Map click listener to select a vertex for keyboard Delete
    this.vertexEditMapClickListener = (event: any) => {
      if (!this.map || !this.vertexEditFeature) return;
      const g = this.vertexEditFeature.getGeometry();
      if (!g) return;

      const clickPixel = this.map.getPixelFromCoordinate(event.coordinate);
      if (!clickPixel) return;

      const coords = getCoordinatesFlat(g);
      let nearestCoord: number[] | null = null;
      let minDistance = 14;

      for (const coord of coords) {
        const p = this.map.getPixelFromCoordinate(coord);
        if (p) {
          const dist = Math.hypot(p[0] - clickPixel[0], p[1] - clickPixel[1]);
          if (dist < minDistance) {
            minDistance = dist;
            nearestCoord = coord;
          }
        }
      }

      this.selectedVertexCoord = nearestCoord;
      updateFeatureStyle();
    };
    this.map.on('click', this.vertexEditMapClickListener);

    // Keyboard listener for Delete/Backspace and Escape
    this.vertexEditKeyHandler = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelVertexEdit();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedVertexCoord) {
          e.preventDefault();
          this.deleteSelectedVertex();
          updateFeatureStyle();
        }
      }
    };
    window.addEventListener('keydown', this.vertexEditKeyHandler);

    this.activateInteraction([modify]);
    return true;
  }

  deleteSelectedVertex(): boolean {
    if (!this.vertexEditFeature || !this.selectedVertexCoord) return false;
    const geom = this.vertexEditFeature.getGeometry();
    if (!geom) return false;

    const geomType = geom.getType();

    if (geomType === 'LineString') {
      const coords = (geom as LineString).getCoordinates();
      if (coords.length <= 2) {
        return false;
      }
      let closestIdx = -1;
      let minD = Infinity;
      coords.forEach((pt: number[], idx: number) => {
        const d = Math.hypot(pt[0] - this.selectedVertexCoord![0], pt[1] - this.selectedVertexCoord![1]);
        if (d < minD) {
          minD = d;
          closestIdx = idx;
        }
      });
      if (closestIdx !== -1) {
        coords.splice(closestIdx, 1);
        (geom as LineString).setCoordinates(coords);
        this.selectedVertexCoord = null;
        this.vertexEditFeature.changed();
        const cur = this.getVertexEditCurrentGeometry();
        if (cur && this.onVertexEditGeometryChange) {
          this.onVertexEditGeometryChange(cur);
        }
        return true;
      }
    } else if (geomType === 'Polygon') {
      const rings = (geom as Polygon).getCoordinates();
      if (!rings || !rings[0] || rings[0].length <= 4) {
        return false;
      }
      const ring = rings[0];
      let closestIdx = -1;
      let minD = Infinity;
      ring.forEach((pt: number[], idx: number) => {
        const d = Math.hypot(pt[0] - this.selectedVertexCoord![0], pt[1] - this.selectedVertexCoord![1]);
        if (d < minD) {
          minD = d;
          closestIdx = idx;
        }
      });
      if (closestIdx !== -1) {
        ring.splice(closestIdx, 1);
        if (closestIdx === 0 || closestIdx === ring.length) {
          ring[ring.length - 1] = [...ring[0]];
        }
        (geom as Polygon).setCoordinates(rings);
        this.selectedVertexCoord = null;
        this.vertexEditFeature.changed();
        const cur = this.getVertexEditCurrentGeometry();
        if (cur && this.onVertexEditGeometryChange) {
          this.onVertexEditGeometryChange(cur);
        }
        return true;
      }
    }

    return false;
  }

  getVertexEditCurrentGeometry(): any | null {
    if (!this.vertexEditFeature) return null;
    const geom = this.vertexEditFeature.getGeometry();
    if (!geom) return null;
    return new GeoJSON().writeGeometryObject(geom, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
  }

  cancelVertexEdit() {
    if (this.vertexEditFeature && this.vertexEditOriginalGeometry) {
      this.vertexEditFeature.setGeometry(this.vertexEditOriginalGeometry.clone());
      this.vertexEditFeature.setStyle(undefined);
      this.vertexEditFeature.changed();
    }
    const cancelCb = this.onVertexEditCancelCallback;
    this.cleanupVertexEdit();
    if (cancelCb) {
      cancelCb();
    }
  }

  finishVertexEdit(): any | null {
    const finalGeom = this.getVertexEditCurrentGeometry();
    if (this.vertexEditFeature) {
      this.vertexEditFeature.setStyle(undefined);
      this.vertexEditFeature.changed();
    }
    this.cleanupVertexEdit();
    return finalGeom;
  }

  isVertexEditingActive(): boolean {
    return this.vertexEditFeature !== null;
  }

  private teardownVertexEditState() {
    if (this.vertexEditKeyHandler) {
      window.removeEventListener('keydown', this.vertexEditKeyHandler);
      this.vertexEditKeyHandler = null;
    }
    if (this.vertexEditMapClickListener && this.map) {
      this.map.un('click', this.vertexEditMapClickListener);
      this.vertexEditMapClickListener = null;
    }
    this.vertexEditFeature = null;
    this.vertexEditOriginalGeometry = null;
    this.selectedVertexCoord = null;
    this.onVertexEditGeometryChange = null;
    this.onVertexEditCancelCallback = null;
  }

  private cleanupVertexEdit() {
    this.teardownVertexEditState();

    if (this.savedSelectCallback) {
      this.activateSelect(this.savedSelectCallback);
    } else {
      this.activateInteraction(null);
    }
  }

  activateTranslate(
    layerName: string,
    onTranslateEnd: (feature: any, rollback: () => void) => void,
    featureId?: string | number | null,
  ) {
    let targetLayer: VectorLayer<any> | null = null;
    if (layerName === 'streetlights') targetLayer = this.streetlightsWfsLayer;
    else if (layerName === 'roads') targetLayer = this.roadsWfsLayer;
    else if (layerName === 'zones') targetLayer = this.zonesWfsLayer;
    else if (layerName === 'states') targetLayer = this.statesWfsLayer;
    else if (layerName === 'districts') targetLayer = this.districtsWfsLayer;

    const select = new Select({
      layers: targetLayer ? [targetLayer] : [],
      hitTolerance: 6,
    });

    let initialFeature: Feature | null = null;
    if (featureId) {
      initialFeature = this.getWfsFeature(layerName, featureId);
      if (initialFeature) {
        select.getFeatures().push(initialFeature);
      }
    }

    const translate = new Translate({
      features: select.getFeatures(),
      hitTolerance: 6,
    });

    let originalGeometryClone: any = initialFeature?.getGeometry()?.clone() || null;
    let targetFeature: Feature | null = initialFeature;

    translate.on('translatestart', (event) => {
      const f = event.features.getArray()[0];
      if (f) {
        targetFeature = f;
        const geom = f.getGeometry();
        if (geom) {
          originalGeometryClone = geom.clone();
        }
      }
    });

    translate.on('translateend', (event) => {
      const translatedFeature = event.features.getArray()[0] || targetFeature;
      if (translatedFeature) {
        const backupGeom = originalGeometryClone ? originalGeometryClone.clone() : null;
        const rollback = () => {
          if (backupGeom && translatedFeature) {
            translatedFeature.setGeometry(backupGeom.clone());
            translatedFeature.changed();
          }
        };

        const geojsonFeature = new GeoJSON().writeFeatureObject(translatedFeature, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        onTranslateEnd(geojsonFeature, rollback);
      }
    });

    this.activateInteraction([select, translate]);
  }

  cancelInteraction() {
    this.activateInteraction(null);
    this.drawSource.clear();
  }
}

export const olService = new OpenLayersService();
