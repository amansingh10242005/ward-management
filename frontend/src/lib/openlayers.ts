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

import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import TileWMS from 'ol/source/TileWMS';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
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
import { fromLonLat, transformExtent } from 'ol/proj';
import { extend } from 'ol/extent';
import Collection from 'ol/Collection';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import { altKeyOnly, singleClick } from 'ol/events/condition';
import { unByKey } from 'ol/Observable';
import { parseFeatureId, isMercatorCoordinates } from '../utils/featureUtils';
import { apiClient } from './api';
import { editSessionHistory } from '../services/editSessionHistory';

const GEOSERVER_URL = import.meta.env.VITE_GEOSERVER_BASE_URL;
const WORKSPACE = import.meta.env.VITE_GEOSERVER_WORKSPACE;

// ── Color palette (matches CSS tokens) ─────────────────────────────────────
const COLORS = {
  streetlight: '#F5B84B',
  road:        '#19B5E6',
  zone:        '#38BDF8',
};



// ── Style factories ─────────────────────────────────────────────────────────

/** Hit-detection style for points (non-zero alpha so canvas hit-detection succeeds) */
const transparentPointStyle = new Style({
  image: new CircleStyle({
    radius: 14,
    fill:   new Fill({ color: 'rgba(245,184,75,0.01)' }),
    stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 4 }),
  }),
});
const transparentLineStyle = new Style({
  stroke: new Stroke({ color: 'rgba(25,181,230,0.01)', width: 16 }),
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
  private map: OlMap | null = null;
  private layers: Record<string, ImageLayer<ImageWMS> | TileLayer<TileWMS> | any> = {};

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
  private selectedRawId: string | number | null = null;
  private selectedFeatureProperties: any = null;

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
    maxResolution: 800, // Active across street and ward scales (zoom >= 8)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.streetlights?.has(rawId)) {
        return new Style({});
      }
      const featId = feature.getId();
      const featRawId = parseFeatureId(featId);
      const featDbId = feature.get('id') ?? feature.get('ID');
      const selDbId = this.selectedFeatureProperties?.id ?? this.selectedFeatureProperties?.ID ?? this.selectedRawId;

      const isSelected = this.selectedLayerName === 'streetlights' && (
        (this.selectedFeatureId !== null && featId === this.selectedFeatureId) ||
        (this.selectedRawId !== null && (featRawId === this.selectedRawId || String(featRawId) === String(this.selectedRawId))) ||
        (selDbId != null && featDbId != null && String(featDbId) === String(selDbId))
      );

      if (isSelected) {
        return makeStreetlightSelectedStyle();
      }
      return transparentPointStyle;
    },
    zIndex: 950,
    visible: false,
  });

  private roadsWfsLayer = new VectorLayer({
    source: this.roadsWfsSource,
    maxResolution: 3000, // Active across ward, city, and district scales (zoom >= 6)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.roads?.has(rawId)) {
        return new Style({});
      }
      const featId = feature.getId();
      const featRawId = parseFeatureId(featId);
      const featDbId = feature.get('id') ?? feature.get('ID');
      const selDbId = this.selectedFeatureProperties?.id ?? this.selectedFeatureProperties?.ID ?? this.selectedRawId;

      const isSelected = this.selectedLayerName === 'roads' && (
        (this.selectedFeatureId !== null && featId === this.selectedFeatureId) ||
        (this.selectedRawId !== null && (featRawId === this.selectedRawId || String(featRawId) === String(this.selectedRawId))) ||
        (selDbId != null && featDbId != null && String(featDbId) === String(selDbId))
      );

      if (isSelected) {
        return makeRoadSelectedStyle();
      }
      return transparentLineStyle;
    },
    zIndex: 930,
    visible: false,
  });

  private zonesWfsLayer = new VectorLayer({
    source: this.zonesWfsSource,
    maxResolution: 3000, // Active at city/zone scale (zoom >= 6)
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

      const featId = feature.getId();
      const featRawId = parseFeatureId(featId);
      const featDbId = feature.get('id') ?? feature.get('ID');
      const featName = (feature.get('name') || '').trim().toLowerCase();
      const selName = (this.selectedFeatureProperties?.name || '').trim().toLowerCase();
      const selDbId = this.selectedFeatureProperties?.id ?? this.selectedFeatureProperties?.ID ?? this.selectedRawId;

      const isSelected = this.selectedLayerName === 'zones' && (
        (this.selectedFeatureId !== null && featId === this.selectedFeatureId) ||
        (this.selectedRawId !== null && (featRawId === this.selectedRawId || String(featRawId) === String(this.selectedRawId))) ||
        (selDbId != null && featDbId != null && String(featDbId) === String(selDbId)) ||
        (Boolean(selName) && Boolean(featName) && featName === selName)
      );

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
    zIndex: 910,
    visible: false,
  });

  private statesWfsLayer = new VectorLayer({
    source: this.statesWfsSource,
    maxResolution: 20000, // Active at subcontinental scale (zoom >= 3)
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.states?.has(rawId)) {
        return new Style({});
      }

      const featId = feature.getId();
      const featRawId = parseFeatureId(featId);
      const featDbId = feature.get('id') ?? feature.get('ID');
      const featState = (feature.get('STATE') || feature.get('state') || '').trim().toUpperCase();
      const selState = (this.selectedFeatureProperties?.STATE || this.selectedFeatureProperties?.state || '').trim().toUpperCase();
      const selDbId = this.selectedFeatureProperties?.id ?? this.selectedFeatureProperties?.ID ?? this.selectedRawId;

      const isSelected = this.selectedLayerName === 'states' && (
        (this.selectedFeatureId !== null && featId === this.selectedFeatureId) ||
        (this.selectedRawId !== null && (featRawId === this.selectedRawId || String(featRawId) === String(this.selectedRawId))) ||
        (selDbId != null && featDbId != null && String(featDbId) === String(selDbId)) ||
        (Boolean(selState) && Boolean(featState) && featState === selState)
      );

      if (isSelected) {
        return new Style({
          fill:   new Fill({ color: 'rgba(244,63,94,0.08)' }),
          stroke: new Stroke({ color: 'rgba(244,63,94,0.60)', width: 6 }),
        });
      }
      return new Style({
        fill:   new Fill({ color: 'rgba(255,255,255,0.01)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 2 }),
      });
    },
    zIndex: 880,
    visible: false,
  });

  private districtsWfsLayer = new VectorLayer({
    source: this.districtsWfsSource,
    maxResolution: 10000, // Active at regional and district scale across zoom levels
    style:  (feature: any) => {
      const rawId = String(parseFeatureId(feature.getId()) ?? feature.getId());
      if (this.hiddenFeatureIds.districts?.has(rawId)) {
        return new Style({});
      }

      const featId = feature.getId();
      const featRawId = parseFeatureId(featId);
      const featDbId = feature.get('id') ?? feature.get('ID');
      const featDistrict = (feature.get('District') || feature.get('district') || '').trim().toUpperCase();
      const selDistrict = (this.selectedFeatureProperties?.District || this.selectedFeatureProperties?.district || '').trim().toUpperCase();
      const selDbId = this.selectedFeatureProperties?.id ?? this.selectedFeatureProperties?.ID ?? this.selectedRawId;

      const isSelected = this.selectedLayerName === 'districts' && (
        (this.selectedFeatureId !== null && featId === this.selectedFeatureId) ||
        (this.selectedRawId !== null && (featRawId === this.selectedRawId || String(featRawId) === String(this.selectedRawId))) ||
        (selDbId != null && featDbId != null && String(featDbId) === String(selDbId)) ||
        (Boolean(selDistrict) && Boolean(featDistrict) && featDistrict === selDistrict)
      );

      if (isSelected) {
        return new Style({
          fill:   new Fill({ color: 'rgba(168,85,247,0.08)' }),
          stroke: new Stroke({ color: 'rgba(168,85,247,0.60)', width: 6 }),
        });
      }
      return new Style({
        fill:   new Fill({ color: 'rgba(255,255,255,0.01)' }),
        stroke: new Stroke({ color: 'rgba(255,255,255,0.01)', width: 2 }),
      });
    },
    zIndex: 890,
    visible: false,
  });

  private activeInteractions: Interaction[] = [];
  private rotationListeners: ((rotation: number) => void)[] = [];
  private moveEndListeners: (() => void)[] = [];
  private layerRefreshListeners: ((layerName: string) => void)[] = [];
  private layerVisibilityListeners: ((layerName: string, isVisible: boolean) => void)[] = [];

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
  private dynamicSelectKey: any = null;
  private updateVertexEditStyles: (() => void) | null = null;
  private currentDrawInteraction: Draw | null = null;
  private currentDrawSketchFeature: Feature | null = null;
  private drawRedoCoordinates: any[] = [];
  private currentTranslateTargetFeature: Feature | null = null;
  public dynamicVectorSource: VectorSource = new VectorSource();
  public dynamicVectorLayer: VectorLayer<VectorSource> = new VectorLayer({
    source: this.dynamicVectorSource,
    style: new Style({
      fill: new Fill({
        color: 'rgba(255, 255, 255, 0.4)',
      }),
      stroke: new Stroke({
        color: '#3399CC',
        width: 3,
      }),
      image: new CircleStyle({
        radius: 7,
        fill: new Fill({
          color: '#ffcc33',
        }),
      }),
    }),
    zIndex: 999, // Render on top of WMS
  });
  private dynamicLayerDefs: Map<string, { layerName: string; qualifiedName: string; workspace: string; latLonBoundingBox?: any }> = new Map();

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
    if (this.map) {
      this.map.setTarget(target);
      return;
    }

    this.layers = {
      zones: new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:zones`, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      states: new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:states`, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      districts: new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:districts`, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      roads: new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:roads`, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      streetlights: new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:streetlights`, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
    };

    // Initialize basemap layer
    const initialSource = this.createBasemapSource(this.currentBasemap);
    this.basemapLayer = new TileLayer({
      source: initialSource || undefined,
      className: this.currentBasemap === 'carto_dark' ? 'dark-osm-basemap' : '',
      zIndex: 0,
    });

    this.map = new OlMap({
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
        this.dynamicVectorLayer,
        this.drawLayer,
      ],
      view: new View({
        center: fromLonLat([80.2707, 13.0827]), // Chennai
        zoom:   12,
      }),
    });

    // Mount any dynamic layers discovered before map initialization
    if (this.dynamicLayerDefs && typeof this.dynamicLayerDefs.forEach === 'function') {
      this.dynamicLayerDefs.forEach((def) => {
        if (!this.layers[def.layerName]) {
          const newLayer = new ImageLayer({
            source: new ImageWMS({
              url:        `${GEOSERVER_URL}/${def.workspace}/wms`,
              params:     { LAYERS: def.qualifiedName, TRANSPARENT: true, FORMAT: 'image/png' },
              ratio:      1,
              serverType: 'geoserver',
              crossOrigin: 'anonymous',
            }),
            visible: false,
            zIndex: 50,
          });
          this.layers[def.layerName] = newLayer;
          this.map!.addLayer(newLayer);
        }
      });
    } else {
      this.dynamicLayerDefs = new Map();
    }

    this.map.getView().on('change:rotation', () => {
      const rot = this.map!.getView().getRotation();
      this.rotationListeners.forEach(l => l(rot));
    });

    // Change cursor to pointer (hand) when hovering over interactive features
    this.map.on('pointermove', (e) => {
      const hasInteractive = this.map!.hasFeatureAtPixel(e.pixel, {
        layerFilter: (layer) => {
          if (layer === this.streetlightsWfsLayer) return this.isLayerVisible('streetlights');
          if (layer === this.roadsWfsLayer) return this.isLayerVisible('roads');
          if (layer === this.zonesWfsLayer) return this.isLayerVisible('zones');
          if (layer === this.dynamicVectorLayer) return true;
          return false;
        },
        hitTolerance: 10,
      });
      this.map!.getTargetElement().style.cursor = hasInteractive ? 'pointer' : '';
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
      (window as any).__olService = this;
      (window as any).__WIM_PERF__ = {
        getMetrics: () => this.getPerfMetrics(),
        reset: () => this.resetPerfMetrics(),
      };
    }
  }

  getMap(): OlMap | null {
    return this.map;
  }

  // ── Dynamic Layers (Phase 7C) ────────────────────────────────────────────────
  
  addDynamicLayer(layerName: string, qualifiedName: string, workspace: string, latLonBoundingBox?: any) {
    if (latLonBoundingBox) {
      const minx = Number(latLonBoundingBox.minx);
      const miny = Number(latLonBoundingBox.miny);
      const maxx = Number(latLonBoundingBox.maxx);
      const maxy = Number(latLonBoundingBox.maxy);
      const isWorld = minx <= -170 && maxx >= 170 && miny <= -85 && maxy >= 80;
      if (!isNaN(minx) && !isNaN(miny) && !isNaN(maxx) && !isNaN(maxy) && !isWorld) {
        this.layerExtentsCache[layerName] = transformExtent([minx, miny, maxx, maxy], 'EPSG:4326', 'EPSG:3857') as [number, number, number, number];
      }
    }

    if (!this.dynamicLayerDefs || typeof this.dynamicLayerDefs.set !== 'function') {
      this.dynamicLayerDefs = new Map();
    }
    this.dynamicLayerDefs.set(layerName, { layerName, qualifiedName, workspace, latLonBoundingBox });

    if (!this.map || this.layers[layerName]) return;
    
    const newLayer = new ImageLayer({
      source: new ImageWMS({
        url:        `${GEOSERVER_URL}/${workspace}/wms`,
        params:     { LAYERS: qualifiedName, TRANSPARENT: true, FORMAT: 'image/png' },
        ratio:      1,
        serverType: 'geoserver',
        crossOrigin: 'anonymous',
      }),
      visible: false,
      zIndex: 50, // Above basemap (0) and administrative polygons, below interactive edits
    });
    
    this.layers[layerName] = newLayer;
    this.map.addLayer(newLayer);

    // Pre-calculate real feature extent in background if needed
    if (!this.layerExtentsCache[layerName]) {
      this.fetchRealLayerExtent(workspace, layerName).catch(() => {});
    }
  }

  private async fetchRealLayerExtent(workspace: string, layerName: string): Promise<[number, number, number, number] | null> {
    try {
      const url = `${GEOSERVER_URL}/${workspace}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${workspace}:${layerName}&outputFormat=application/json&maxFeatures=100&srsname=EPSG:3857`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const features = new GeoJSON().readFeatures(data);
      if (features && features.length > 0) {
        let combined: [number, number, number, number] | null = null;
        for (const feat of features) {
          const geom = feat.getGeometry();
          if (geom) {
            const ext = geom.getExtent() as [number, number, number, number];
            if (!combined) {
              combined = [ext[0], ext[1], ext[2], ext[3]];
            } else {
              extend(combined, ext);
            }
          }
        }
        if (combined) {
          this.layerExtentsCache[layerName] = combined;
          return combined;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  toggleDynamicLayer(layerName: string, isVisible: boolean) {
    if (!this.dynamicLayerDefs || typeof this.dynamicLayerDefs.has !== 'function') {
      this.dynamicLayerDefs = new Map();
    }
    if (this.map && !this.layers[layerName] && this.dynamicLayerDefs.has(layerName)) {
      const def = this.dynamicLayerDefs.get(layerName)!;
      const newLayer = new ImageLayer({
        source: new ImageWMS({
          url:        `${GEOSERVER_URL}/${def.workspace}/wms`,
          params:     { LAYERS: def.qualifiedName, TRANSPARENT: true, FORMAT: 'image/png' },
          ratio:      1,
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
        zIndex: 50,
      });
      this.layers[def.layerName] = newLayer;
      this.map.addLayer(newLayer);
    }

    const layer = this.layers[layerName];
    if (layer) {
      layer.setVisible(isVisible);
    }
    this.layerVisibilityListeners.forEach(l => l(layerName, isVisible));
  }

  async zoomToDynamicLayerExtent(layerMeta: any) {
    if (!this.map) return;
    
    const layerName = typeof layerMeta === 'string' ? layerMeta : layerMeta?.name;
    if (!layerName) return;

    const isWorldExtent = (ext: any) => {
      if (!ext || !Array.isArray(ext) || ext.length < 4) return true;
      const [minx, miny, maxx, maxy] = ext;
      // EPSG:4326 world bounds approx
      if (minx <= -179 && maxx >= 179 && miny <= -89 && maxy >= 89) return true;
      // EPSG:3857 world bounds approx
      if (minx <= -18000000 && maxx >= 18000000) return true;
      return false;
    };


    if (this.layerExtentsCache[layerName]) {
      this.map.getView().fit(this.layerExtentsCache[layerName], { padding: [60, 60, 60, 380], duration: 800, maxZoom: 16 });
      return;
    }

    const def = this.dynamicLayerDefs?.get(layerName);
    const meta = typeof layerMeta === 'object' && layerMeta !== null ? layerMeta : def;
    const box = meta?.latLonBoundingBox || def?.latLonBoundingBox;

    if (box) {
      const minx = Number(box.minx);
      const miny = Number(box.miny);
      const maxx = Number(box.maxx);
      const maxy = Number(box.maxy);
      if (!isNaN(minx) && !isNaN(miny) && !isNaN(maxx) && !isNaN(maxy)) {
        if (!isWorldExtent([minx, miny, maxx, maxy])) {
          const extent3857 = transformExtent([minx, miny, maxx, maxy], 'EPSG:4326', 'EPSG:3857') as [number, number, number, number];
          this.layerExtentsCache[layerName] = extent3857;
          this.map.getView().fit(extent3857, { padding: [60, 60, 60, 380], duration: 800, maxZoom: 16 });
          return;
        }
      }
    }

    const nativeBox = meta?.nativeBoundingBox || (def as any)?.nativeBoundingBox;
    if (nativeBox) {
      const minx = Number(nativeBox.minx);
      const miny = Number(nativeBox.miny);
      const maxx = Number(nativeBox.maxx);
      const maxy = Number(nativeBox.maxy);
      const crs = String(nativeBox.crs || meta?.srs || 'EPSG:4326');
      if (!isNaN(minx) && !isNaN(miny) && !isNaN(maxx) && !isNaN(maxy)) {
        if (!isWorldExtent([minx, miny, maxx, maxy])) {
          const extent3857 = (crs.includes('3857') || crs.includes('900913'))
            ? [minx, miny, maxx, maxy] as [number, number, number, number]
            : transformExtent([minx, miny, maxx, maxy], crs, 'EPSG:3857') as [number, number, number, number];
          this.layerExtentsCache[layerName] = extent3857;
          this.map.getView().fit(extent3857, { padding: [60, 60, 60, 380], duration: 800, maxZoom: 16 });
          return;
        }
      }
    }

    // Query GeoServer WFS GetFeature to calculate actual feature bounding box
    const workspace = meta?.workspace || def?.workspace || WORKSPACE;
    const realExtent = await this.fetchRealLayerExtent(workspace, layerName);
    if (realExtent) {
      this.map.getView().fit(realExtent, { padding: [60, 60, 60, 380], duration: 800, maxZoom: 16 });
      return;
    }

    // Safe fallback: Zoom to Chennai ward region (never Antarctica/world ocean)
    const chennaiWardExtent: [number, number, number, number] = [8910000, 1445000, 8935000, 1470000];
    this.map.getView().fit(chennaiWardExtent, { padding: [60, 60, 60, 380], duration: 800, maxZoom: 14 });
  }

  // ── Selected feature glow ────────────────────────────────────────────────────

  /**
   * Tell the WFS vector layers which feature is selected so their style
   * functions can apply the neon glow. Pass (null, null) to clear selection.
   */
  setSelectedFeature(layerName: string | null, featureId: string | number | null, fallbackGeoJson?: any) {
    this.selectedLayerName  = layerName;
    this.selectedFeatureId  = featureId;
    this.selectedRawId      = parseFeatureId(featureId);
    this.selectedFeatureProperties = fallbackGeoJson?.properties || (fallbackGeoJson?.type === 'Feature' ? fallbackGeoJson.properties : fallbackGeoJson) || null;

    if (!layerName) {
      this.selectedLayerName = null;
      this.selectedFeatureId = null;
      this.selectedRawId = null;
      this.selectedFeatureProperties = null;
    }

    const isCoreLayer = ['states', 'districts', 'zones', 'roads', 'streetlights'].includes(layerName || '');
    
    if (layerName && !isCoreLayer) {
      if (fallbackGeoJson && fallbackGeoJson.geometry && fallbackGeoJson.geometry.type) {
        if (this.dynamicVectorSource) {
          this.dynamicVectorSource.clear();
          try {
            const rawFeature = new GeoJSON().readFeature(fallbackGeoJson, {
              dataProjection: 'EPSG:4326',
              featureProjection: 'EPSG:3857'
            });
            const feature: Feature = (Array.isArray(rawFeature) ? rawFeature[0] : rawFeature) as Feature;
            if (!feature.getId() && featureId) {
              feature.setId(featureId);
            }
            this.dynamicVectorSource.addFeature(feature);
          } catch (e) {
            console.warn('[OpenLayers] Could not parse fallback feature geometry:', e);
          }
        }
      } else {
        // If fallbackGeoJson was omitted, check if this feature is already in dynamicVectorSource
        const existing = featureId && this.dynamicVectorSource ? (this.dynamicVectorSource.getFeatureById(featureId) || this.dynamicVectorSource.getFeatures().find(f => f.getId() === featureId || String(f.getId()) === String(featureId))) : null;
        if (!existing && this.dynamicVectorSource) {
          this.dynamicVectorSource.clear();
        }
      }
    } else {
      // Core layer or deselection: clear dynamic vector source
      if (this.dynamicVectorSource) {
        this.dynamicVectorSource.clear();
      }
      if (layerName && isCoreLayer && fallbackGeoJson) {
        this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId!, fallbackGeoJson);
      }
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
    signal?: AbortSignal,
    startIndex: number = 0,
    maxFeatures: number = 40
  ): Promise<any> {
    if (!this.map) {
      const emptyRes: any = [];
      emptyRes.features = [];
      emptyRes.totalCount = 0;
      emptyRes.hasMore = false;
      return emptyRes;
    }
    
    let cqlFilter = '';
    if (search.trim()) {
      const searchStr = search.replace(/'/g, "''");
      switch (layerName) {
        case 'states':
          cqlFilter = `STATE ILIKE '%${searchStr}%'`;
          break;
        case 'districts':
          cqlFilter = `District ILIKE '%${searchStr}%' OR STATE ILIKE '%${searchStr}%'`;
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
        default:
          cqlFilter = `strToLowerCase(name) LIKE '%${searchStr.toLowerCase()}%'`;
          break;
      }
    }

    // Property projection based on layer to avoid fetching multi-megabyte geometries for feature listing/search
    let propertyNames = '';
    let sortProp = '';
    switch (layerName) {
      case 'states':
        propertyNames = 'id,STATE';
        sortProp = 'STATE A';
        break;
      case 'districts':
        propertyNames = 'id,District,STATE';
        sortProp = 'District A';
        break;
      case 'zones':
        propertyNames = 'id,name,type';
        sortProp = 'name A';
        break;
      case 'roads':
        propertyNames = 'id,name,category,zone_id';
        sortProp = 'name A';
        break;
      case 'streetlights':
        propertyNames = 'id,name,type,zone_id,road_id';
        sortProp = 'name A';
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
    url.searchParams.append('maxFeatures', String(maxFeatures));
    if (startIndex > 0) {
      url.searchParams.append('startIndex', String(startIndex));
    }
    if (sortProp) {
      url.searchParams.append('sortBy', sortProp);
    }
    if (propertyNames) {
      url.searchParams.append('propertyName', propertyNames);
    }
    if (cqlFilter) {
      url.searchParams.append('cql_filter', cqlFilter);
    }

    const startTime = performance.now();
    try {
      let res = await fetch(url.toString(), { signal });
      let text = res.ok ? await res.text() : '';

      // Fallback 1: If GeoServer returned error, retry without sortBy
      if ((!text || !text.trim().startsWith('{')) && url.searchParams.has('sortBy')) {
        url.searchParams.delete('sortBy');
        res = await fetch(url.toString(), { signal });
        text = res.ok ? await res.text() : '';
      }

      // Fallback 2: If GeoServer returned error, retry with minimal safe properties (id, name/state/district)
      if ((!text || !text.trim().startsWith('{')) && propertyNames) {
        const safeProps = layerName === 'states' ? 'id,STATE' : (layerName === 'districts' ? 'id,District' : 'id,name');
        url.searchParams.set('propertyName', safeProps);
        res = await fetch(url.toString(), { signal });
        text = res.ok ? await res.text() : '';
      }

      // Fallback 3: If still error, retry without propertyName
      if ((!text || !text.trim().startsWith('{')) && url.searchParams.has('propertyName')) {
        url.searchParams.delete('propertyName');
        res = await fetch(url.toString(), { signal });
        text = res.ok ? await res.text() : '';
      }

      // Fallback 4: If still error and we guessed a cqlFilter for dynamic layers, retry without it
      if ((!text || !text.trim().startsWith('{')) && url.searchParams.has('cql_filter')) {
        url.searchParams.delete('cql_filter');
        res = await fetch(url.toString(), { signal });
        text = res.ok ? await res.text() : '';
      }

      if (!res.ok || !text.trim().startsWith('{')) {
        const emptyRes: any = [];
        emptyRes.features = [];
        emptyRes.totalCount = 0;
        emptyRes.hasMore = false;
        return emptyRes;
      }

      const duration = performance.now() - startTime;
      const payloadBytes = new Blob([text]).size;
      const data = JSON.parse(text);
      const features = data.features || [];

      // Determine totalCount
      let totalCount = features.length;
      if (typeof data.totalFeatures === 'number') {
        totalCount = data.totalFeatures;
      } else if (typeof data.numberMatched === 'number') {
        totalCount = data.numberMatched;
      } else if (features.length < maxFeatures) {
        totalCount = startIndex + features.length;
      } else {
        totalCount = startIndex + features.length + 1;
      }

      // Sort client-side only if GeoServer didn't use sortBy
      if (Array.isArray(features) && !url.searchParams.has('sortBy')) {
        features.sort((a: any, b: any) => {
          const nameA = a.properties?.district || a.properties?.District || a.properties?.state || a.properties?.STATE || a.properties?.name || '';
          const nameB = b.properties?.district || b.properties?.District || b.properties?.state || b.properties?.STATE || b.properties?.name || '';
          return String(nameA).localeCompare(String(nameB), undefined, { sensitivity: 'base' });
        });
      }

      const hasMore = features.length === maxFeatures && (
        typeof data.totalFeatures === 'number'
          ? (startIndex + features.length < data.totalFeatures)
          : true
      );

      const result: any = [...features];
      result.features = features;
      result.totalCount = totalCount;
      result.hasMore = hasMore;

      // Record performance metrics
      this.perfMetrics.searchRequests++;
      this.perfMetrics.lastSearchDurationMs = Math.round(duration);
      this.perfMetrics.lastSearchPayloadBytes = payloadBytes;
      this.perfMetrics.lastSearchFeatureCount = features.length;

      return result;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Request cancelled by newer search
        const abortedRes: any = [];
        abortedRes.features = [];
        abortedRes.totalCount = 0;
        abortedRes.hasMore = false;
        return abortedRes;
      }
      console.error('Failed to search features from backend', err);
      const errRes: any = [];
      errRes.features = [];
      errRes.totalCount = 0;
      errRes.hasMore = false;
      return errRes;
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
    if (featureId === undefined || featureId === null) return null;
    let source: VectorSource | null = null;
    if (layerName === 'zones') source = this.zonesWfsSource;
    else if (layerName === 'roads') source = this.roadsWfsSource;
    else if (layerName === 'streetlights') source = this.streetlightsWfsSource;
    else if (layerName === 'states') source = this.statesWfsSource;
    else if (layerName === 'districts') source = this.districtsWfsSource;
    else source = this.dynamicVectorSource;

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
      if (rawId !== null) {
        if (fid === rawId || parseFeatureId(fid) === rawId) return f as Feature;
        const propId = f.get('id') ?? f.get('ID');
        if (propId != null && String(propId) === String(rawId)) return f as Feature;
      }
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
    else source = this.dynamicVectorSource;

    if (!source || !geoJson) return null;

    const geomData = geoJson.geometry || (geoJson.type && geoJson.coordinates ? geoJson : null);
    if (!geomData || !geomData.coordinates) return null;

    try {
      const is3857 = isMercatorCoordinates(geomData.coordinates);

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

      let existing = (fid != null && fid !== '') ? (source.getFeatureById(fid) || source.getFeatureById(`${layerName}.${fid}`)) : null;
      if (!existing && featureId != null && featureId !== '') {
        existing = source.getFeatureById(featureId) || source.getFeatureById(`${layerName}.${featureId}`);
      }
      if (!existing) {
        const propId = feature.get('id') ?? feature.get('ID');
        if (propId != null) {
          existing = source.getFeatures().find(f => {
            const pid = f.get('id') ?? f.get('ID');
            return pid != null && String(pid) === String(propId);
          }) || null;
        }
      }

      if (existing) {
        const newGeom = feature.getGeometry();
        if (newGeom) existing.setGeometry(newGeom);
        const newProps = feature.getProperties();
        if (newProps) existing.setProperties(newProps);
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

  getWfsSource(layerName: string): VectorSource | null {
    if (layerName === 'zones') return this.zonesWfsSource;
    if (layerName === 'roads') return this.roadsWfsSource;
    if (layerName === 'streetlights') return this.streetlightsWfsSource;
    if (layerName === 'states') return this.statesWfsSource;
    if (layerName === 'districts') return this.districtsWfsSource;
    return this.dynamicVectorSource || null;
  }

  async centerOnFeature(layerName: string, featureId: string | number, fallbackGeoJson?: any): Promise<any> {
    if (!this.map) return fallbackGeoJson || null;
    let feature = this.getWfsFeature(layerName, featureId);
    let resolvedGeoJson = fallbackGeoJson;

    // Check if the current feature's geometry is valid (not missing, not NaN/Infinity)
    let geom = feature?.getGeometry();
    let extent = geom?.getExtent();
    const isFeatureValid = geom && extent && !extent.some(isNaN) && extent.every(isFinite);

    if (!isFeatureValid && fallbackGeoJson && fallbackGeoJson.geometry) {
      feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, fallbackGeoJson);
      geom = feature?.getGeometry();
      extent = geom?.getExtent();
    }

    const isGeomStillValid = geom && extent && !extent.some(isNaN) && extent.every(isFinite);

    // If feature geometry is not yet present or invalid, fetch the single feature's full geometry from GeoServer on demand
    if (!isGeomStillValid) {
      try {
        const rawId = parseFeatureId(featureId) ?? featureId;
        const props = fallbackGeoJson?.properties || (fallbackGeoJson?.type === 'Feature' ? fallbackGeoJson.properties : fallbackGeoJson) || {};
        const baseUrl = GEOSERVER_URL.startsWith('http') ? GEOSERVER_URL : window.location.origin + GEOSERVER_URL;

        let fetchedFeatures: any[] = [];

        // 1. Try CQL filter by numeric id (works for states, districts, zones, roads, streetlights in GeoServer)
        const numericId = typeof featureId === 'number'
          ? featureId
          : (props.id != null && !isNaN(Number(props.id))
              ? Number(props.id)
              : (!isNaN(Number(rawId)) ? Number(rawId) : null));

        if (numericId !== null) {
          try {
            const cqlUrl = `${baseUrl}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${layerName}&outputFormat=application/json&srsname=EPSG:3857&cql_filter=id=${numericId}`;
            const res = await fetch(cqlUrl);
            if (res.ok) {
              const data = await res.json();
              if (data.features && data.features.length > 0) {
                fetchedFeatures = data.features;
              }
            }
          } catch (err) {
            console.warn('CQL query by id failed:', err);
          }
        }

        // 2. Try CQL filter by layer-specific name if id query didn't return features
        if (fetchedFeatures.length === 0) {
          let nameFilter: string | null = null;
          if (layerName === 'states' && (props.STATE || props.state)) {
            const stName = String(props.STATE || props.state).replace(/'/g, "''");
            nameFilter = `STATE='${stName}'`;
          } else if (layerName === 'districts' && (props.District || props.district)) {
            const distName = String(props.District || props.district).replace(/'/g, "''");
            nameFilter = `District='${distName}'`;
          } else if ((layerName === 'zones' || layerName === 'roads' || layerName === 'streetlights') && props.name) {
            const nameVal = String(props.name).replace(/'/g, "''");
            nameFilter = `name='${nameVal}'`;
          }

          if (nameFilter) {
            try {
              const cqlUrl = `${baseUrl}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${layerName}&outputFormat=application/json&srsname=EPSG:3857&cql_filter=${encodeURIComponent(nameFilter)}`;
              const res = await fetch(cqlUrl);
              if (res.ok) {
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                  fetchedFeatures = data.features;
                }
              }
            } catch (err) {
              console.warn('CQL query by name failed:', err);
            }
          }
        }

        // 3. Try GeoServer featureID as fallback
        if (fetchedFeatures.length === 0) {
          const fidParam = String(rawId).includes('.') ? rawId : `${layerName}.${rawId}`;
          try {
            const fidUrl = `${baseUrl}/${WORKSPACE}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${WORKSPACE}:${layerName}&outputFormat=application/json&srsname=EPSG:3857&featureID=${fidParam}`;
            const res = await fetch(fidUrl);
            if (res.ok) {
              const data = await res.json();
              if (data.features && data.features.length > 0) {
                fetchedFeatures = data.features;
              }
            }
          } catch (err) {
            console.warn('featureID query failed:', err);
          }
        }

        if (fetchedFeatures.length > 0) {
          resolvedGeoJson = fetchedFeatures[0];
          feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, fetchedFeatures[0]);
          geom = feature?.getGeometry();
          extent = geom?.getExtent();
          this.refreshWfsLayerStyles();
        }
      } catch (e) {
        console.warn('Failed to fetch full geometry for centerOnFeature:', e);
      }
    }

    if (feature && geom && extent && !extent.some(isNaN) && extent.every(isFinite)) {
      const geomType = geom.getType();
      if (geomType === 'Point') {
        // Streetlights: zoom to street level
        this.map.getView().animate({
          center: (geom as Point).getCoordinates(),
          zoom: Math.max(this.map.getView().getZoom() ?? 0, 17),
          duration: 600,
        });
      } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
        // Roads: fit with good padding, don't over-zoom
        this.map.getView().fit(extent, {
          padding: [80, 80, 80, 80],
          maxZoom: 16,
          minResolution: 1,
          duration: 600,
        });
      } else if (layerName === 'states' || layerName === 'districts') {
        // States/Districts: fit to boundary, don't zoom too close
        this.map.getView().fit(extent, {
          padding: [60, 60, 60, 60],
          maxZoom: 10,
          duration: 600,
        });
      } else {
        this.map.getView().fit(extent, {
          padding: [60, 60, 60, 60],
          maxZoom: 16,
          duration: 600,
        });
      }

      if (!resolvedGeoJson || !resolvedGeoJson.geometry) {
        try {
          resolvedGeoJson = new GeoJSON().writeFeatureObject(feature, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:4326',
          });
        } catch {
          // ignore
        }
      }
      return resolvedGeoJson;
    }

    const geomData = fallbackGeoJson?.geometry || fallbackGeoJson;
    if (geomData && geomData.type && geomData.coordinates) {
      try {
        const is3857 = isMercatorCoordinates(geomData.coordinates);
        const fallbackGeom = new GeoJSON().readGeometry(geomData, {
          dataProjection: is3857 ? 'EPSG:3857' : 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        const fallbackExtent = fallbackGeom?.getExtent();
        if (fallbackGeom && fallbackExtent && !fallbackExtent.some(isNaN) && fallbackExtent.every(isFinite)) {
          const fbType = fallbackGeom.getType();
          if (fbType === 'Point') {
            this.map.getView().animate({
              center: (fallbackGeom as Point).getCoordinates(),
              zoom: Math.max(this.map.getView().getZoom() ?? 0, 17),
              duration: 600,
            });
          } else {
            const fbMaxZoom = (layerName === 'states' || layerName === 'districts') ? 10 : 16;
            this.map.getView().fit(fallbackExtent, {
              padding: [60, 60, 60, 60],
              maxZoom: fbMaxZoom,
              duration: 600,
            });
          }
        }
      } catch (err) {
        console.warn('Failed to parse geometry for centerOnFeature fallback:', err);
      }
    }

    return resolvedGeoJson;
  }

  // Pre-cached spatial bounds (EPSG:3857) to ensure instant zero-latency navigation without large WFS downloads
  private layerExtentsCache: Record<string, [number, number, number, number]> = {
    states: [7579624, 750000, 10842500, 4260000],       // All India
    districts: [7579624, 750000, 10842500, 4260000],    // All India
  };

  /**
   * Safely navigate to the layer's full extent without downloading the entire dataset.
   * Priority: Loaded vector features -> Cached layer bounds -> GeoServer WMS capabilities BoundingBox
   */
  async zoomToLayer(layerName: string) {
    if (!this.map) return;

    // Use cached/configured layer bounds for instant safe navigation
    if (this.layerExtentsCache[layerName]) {
      this.map.getView().fit(this.layerExtentsCache[layerName], {
        padding: [60, 60, 60, 380],
        duration: 600,
        maxZoom: layerName === 'streetlights' ? 18 : layerName === 'roads' ? 17 : 15,
      });
      return;
    }

    // Fallback: try Backend API to get PostGIS bounds
    try {
      const extent = await apiClient.spatial.getExtent(layerName);
      if (extent) {
        this.layerExtentsCache[layerName] = extent;
        this.map.getView().fit(extent, {
          padding: [60, 60, 60, 380],
          duration: 600,
          maxZoom: layerName === 'streetlights' ? 18 : layerName === 'roads' ? 17 : 15,
        });
        return;
      }
    } catch (e) {
      console.warn('Failed to fetch layer bounds from backend:', e);
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
    this.layerVisibilityListeners.forEach(l => l(layerName, visible));
  }

  onLayerVisibilityChange(listener: (layerName: string, isVisible: boolean) => void) {
    this.layerVisibilityListeners.push(listener);
    return () => {
      this.layerVisibilityListeners = this.layerVisibilityListeners.filter(l => l !== listener);
    };
  }

  isLayerVisible(layerName: string): boolean {
    return !!this.layers[layerName]?.getVisible();
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
    const isCoreLayer = ['streetlights', 'roads', 'zones', 'states', 'districts'].includes(layerName);
    if (!isCoreLayer) {
      if (this.dynamicVectorSource) {
        const f = this.dynamicVectorSource.getFeatureById(featureId);
        if (f) {
          this.dynamicVectorSource.removeFeature(f);
        } else {
          const allFeatures = this.dynamicVectorSource.getFeatures();
          for (const feature of allFeatures) {
            if (feature.getId() === featureId || String(feature.getId()) === String(featureId)) {
              this.dynamicVectorSource.removeFeature(feature);
            }
          }
        }
      }
      if (this.selectedFeatureId === featureId || String(this.selectedFeatureId) === String(featureId)) {
        this.setSelectedFeature(null, null);
      }
      return;
    }

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

  clearDynamicFeatures() {
    if (this.dynamicVectorSource) {
      this.dynamicVectorSource.clear();
    }
  }

  cleanupDynamicSelect() {
    if (this.dynamicSelectKey) {
      unByKey(this.dynamicSelectKey);
      this.dynamicSelectKey = null;
    }
  }

  // ── Interactions ──────────────────────────────────────────────────────────────

  private activateInteraction(interactions: Interaction | Interaction[] | null) {
    this.cleanupDynamicSelect();
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

    this.currentDrawInteraction = draw;
    this.drawRedoCoordinates = [];
    editSessionHistory.startSession('create', null);

    draw.on('drawstart', (event) => {
      this.currentDrawSketchFeature = event.feature;
      const geom = event.feature.getGeometry();
      if (geom) {
        geom.on('change', () => {
          const geomType = geom.getType();
          if (geomType === 'LineString' || geomType === 'Polygon') {
            const coords = (geom as any).getCoordinates();
            const list = geomType === 'Polygon' ? coords[0] : coords;
            if (list && list.length > 0) {
              editSessionHistory.pushSnapshot(JSON.parse(JSON.stringify(list)));
            }
          }
        });
      }
    });

    draw.on('drawend', (event) => {
      this.currentDrawSketchFeature = null;
      this.currentDrawInteraction = null;
      this.drawRedoCoordinates = [];
      editSessionHistory.clearSession();
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
    this.activateInteraction([]);
    this.cleanupDynamicSelect();

    if (!this.map) return;

    // Use singleclick with prioritized hit detection across layer types:
    // Streetlights (Point) > Roads (LineString) > Zones (Local Polygon) > Dynamic Layers > Districts > States
    this.dynamicSelectKey = this.map.on('singleclick', async (evt) => {
      if (!this.map) return;

      const candidates: { feature: Feature; layerName: string; priority: number }[] = [];

      this.map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, layer) => {
          if (!feature || !layer) return;

          let layerName = '';
          let priority = 0;

          if (layer === this.streetlightsWfsLayer && this.isLayerVisible('streetlights')) {
            layerName = 'streetlights';
            priority = 100; // Point features: highest priority
          } else if (layer === this.roadsWfsLayer && this.isLayerVisible('roads')) {
            layerName = 'roads';
            priority = 80; // Line features: high priority
          } else if (layer === this.zonesWfsLayer && this.isLayerVisible('zones')) {
            layerName = 'zones';
            priority = 60; // Ward polygons: medium priority
          } else if (layer === this.dynamicVectorLayer) {
            layerName = this.selectedLayerName || 'dynamic';
            priority = 50; // Dynamic imported layers
          } else if (layer === this.districtsWfsLayer && this.isLayerVisible('districts')) {
            layerName = 'districts';
            priority = 30; // District boundaries: lower priority
          } else if (layer === this.statesWfsLayer && this.isLayerVisible('states')) {
            layerName = 'states';
            priority = 10; // State boundaries: lowest priority
          }

          if (layerName) {
            const rawId = String(parseFeatureId((feature as any).getId()) ?? (feature as any).getId());
            if (!this.hiddenFeatureIds[layerName]?.has(rawId)) {
              candidates.push({ feature: feature as Feature, layerName, priority });
            }
          }
        },
        { hitTolerance: 12 }
      );

      if (candidates.length > 0) {
        // Sort candidates descending by priority so points and lines always win over background polygons
        candidates.sort((a, b) => b.priority - a.priority);
        const top = candidates[0];

        const geojsonFeature = new GeoJSON().writeFeatureObject(top.feature, {
          dataProjection:    'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });

        // Always apply glow and fire onSelect — even if same feature clicked again
        this.setSelectedFeature(top.layerName, geojsonFeature.id ?? null, geojsonFeature);
        onSelect(geojsonFeature, top.layerName);
        return;
      }

      // If no vector feature hit, check visible dynamic WMS layers via GetFeatureInfo
      const viewResolution = this.map.getView().getResolution();
      const viewProjection = this.map.getView().getProjection();

      let hitDynamic = false;
      for (const [layerName, layer] of Object.entries(this.layers)) {
        if (!['states', 'districts', 'zones', 'roads', 'streetlights'].includes(layerName) && layer.getVisible()) {
          const source = layer.getSource();
          if (source && (source as any).getFeatureInfoUrl) {
            const url = (source as any).getFeatureInfoUrl(
              evt.coordinate,
              viewResolution,
              viewProjection,
              { 'INFO_FORMAT': 'application/json', 'FEATURE_COUNT': 1 }
            );

            if (url) {
              try {
                const res = await fetch(url);
                if (res.ok) {
                  const data = await res.json();
                  if (data.features && data.features.length > 0) {
                    const selectedFeature = data.features[0];
                    hitDynamic = true;

                    // Highlight the temporary feature
                    this.setSelectedFeature(layerName, selectedFeature.id, selectedFeature);
                    onSelect(selectedFeature, layerName);
                    break; // Only select top-most hit
                  }
                }
              } catch (err) {
                console.error('WMS GetFeatureInfo error:', err);
              }
            }
          }
        }
      }

      // If neither WFS nor WMS returned a feature, clear selection
      if (!hitDynamic) {
        this.setSelectedFeature(null, null);
        onSelect(null, '');
      }
    });
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

    const isCoreLayer = ['states', 'districts', 'zones', 'roads', 'streetlights'].includes(layerName);

    // 1. Locate the feature in WFS layer or construct it
    let feature: Feature | null = null;
    if (isCoreLayer) {
      feature = this.getWfsFeature(layerName, featureId) || null;
      if (!feature && initialGeoJson) {
        feature = this.addOrUpdateWfsFeatureFromGeoJson(layerName, featureId, initialGeoJson) || null;
      }
    } else {
      feature = (this.dynamicVectorSource.getFeatureById(featureId) as Feature) || null;
      if (!feature && initialGeoJson) {
        const rawFeature = new GeoJSON().readFeature(initialGeoJson, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857'
        });
        const dynamicFeat: Feature = (Array.isArray(rawFeature) ? rawFeature[0] : rawFeature) as Feature;
        if (!dynamicFeat.getId() && featureId) {
          dynamicFeat.setId(featureId);
        }
        this.dynamicVectorSource.addFeature(dynamicFeat);
        feature = dynamicFeat;
      }
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

    const initialGeomGeoJson = new GeoJSON().writeGeometryObject(geom, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    editSessionHistory.startSession('vertex_edit', initialGeomGeoJson);

    const geomType = geom.getType();

    // 4. Point feature (Streetlights): Position Edit behavior
    if (geomType === 'Point') {
      const editCollection = new Collection<Feature>([feature]);
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
        if (curGeom) {
          editSessionHistory.pushSnapshot(curGeom);
          if (this.onVertexEditGeometryChange) {
            this.onVertexEditGeometryChange(curGeom);
          }
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

    this.updateVertexEditStyles = updateFeatureStyle;
    updateFeatureStyle();

    const editFeatures = new Collection<Feature>([feature!]);
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
      if (current) {
        editSessionHistory.pushSnapshot(current);
        if (this.onVertexEditGeometryChange) {
          this.onVertexEditGeometryChange(current);
        }
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
        if (cur) {
          editSessionHistory.pushSnapshot(cur);
          if (this.onVertexEditGeometryChange) {
            this.onVertexEditGeometryChange(cur);
          }
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
        if (cur) {
          editSessionHistory.pushSnapshot(cur);
          if (this.onVertexEditGeometryChange) {
            this.onVertexEditGeometryChange(cur);
          }
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

  setVertexEditGeometry(geometryGeoJson: any, pushToHistory = false) {
    if (!this.vertexEditFeature || !geometryGeoJson) return;
    const olGeom = new GeoJSON().readGeometry(geometryGeoJson, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857',
    });
    this.vertexEditFeature.setGeometry(olGeom);
    this.selectedVertexCoord = null;
    this.vertexEditFeature.changed();
    if (this.updateVertexEditStyles) {
      this.updateVertexEditStyles();
    }
    if (pushToHistory) {
      editSessionHistory.pushSnapshot(geometryGeoJson);
    }
    if (this.onVertexEditGeometryChange) {
      this.onVertexEditGeometryChange(geometryGeoJson);
    }
  }

  undoVertexEdit(): boolean {
    if (!editSessionHistory.canUndo()) return false;
    const prevGeom = editSessionHistory.undo();
    if (prevGeom) {
      this.setVertexEditGeometry(prevGeom);
      return true;
    }
    return false;
  }

  redoVertexEdit(): boolean {
    if (!editSessionHistory.canRedo()) return false;
    const nextGeom = editSessionHistory.redo();
    if (nextGeom) {
      this.setVertexEditGeometry(nextGeom);
      return true;
    }
    return false;
  }

  undoDrawPoint(): boolean {
    if (editSessionHistory.canUndo()) {
      if (this.currentDrawInteraction) {
        try {
          const sketchGeom = this.currentDrawSketchFeature?.getGeometry();
          if (sketchGeom) {
            const type = sketchGeom.getType();
            if (type === 'LineString' || type === 'Polygon') {
              const coords = (sketchGeom as any).getCoordinates();
              const list = type === 'Polygon' ? coords[0] : coords;
              if (list && list.length > 2) {
                const removed = list[list.length - 2];
                this.drawRedoCoordinates.push(removed);
              }
            }
          }
          this.currentDrawInteraction.removeLastPoint();
        } catch (err) {
          console.warn('undoDrawPoint error:', err);
        }
      }
      editSessionHistory.undo();
      return true;
    }
    return false;
  }

  redoDrawPoint(): boolean {
    if (editSessionHistory.canRedo()) {
      if (this.currentDrawInteraction && this.drawRedoCoordinates.length > 0) {
        const coord = this.drawRedoCoordinates.pop();
        if (coord) {
          this.currentDrawInteraction.appendCoordinates([coord]);
        }
      }
      editSessionHistory.redo();
      return true;
    }
    return false;
  }

  undoMove(): boolean {
    if (!editSessionHistory.canUndo() || !this.currentTranslateTargetFeature) return false;
    const prevGeom = editSessionHistory.undo();
    if (prevGeom) {
      const olGeom = new GeoJSON().readGeometry(prevGeom, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      this.currentTranslateTargetFeature.setGeometry(olGeom);
      this.currentTranslateTargetFeature.changed();
      return true;
    }
    return false;
  }

  redoMove(): boolean {
    if (!editSessionHistory.canRedo() || !this.currentTranslateTargetFeature) return false;
    const nextGeom = editSessionHistory.redo();
    if (nextGeom) {
      const olGeom = new GeoJSON().readGeometry(nextGeom, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      this.currentTranslateTargetFeature.setGeometry(olGeom);
      this.currentTranslateTargetFeature.changed();
      return true;
    }
    return false;
  }

  cancelVertexEdit() {
    if (this.vertexEditFeature && this.vertexEditOriginalGeometry) {
      this.vertexEditFeature.setGeometry(this.vertexEditOriginalGeometry.clone());
      this.vertexEditFeature.setStyle(undefined);
      this.vertexEditFeature.changed();
    }
    editSessionHistory.clearSession();
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
    editSessionHistory.clearSession();
    this.cleanupVertexEdit();
    return finalGeom;
  }

  isVertexEditingActive(): boolean {
    return this.vertexEditFeature !== null;
  }

  private teardownVertexEditState() {
    this.cleanupDynamicSelect();
    if (this.vertexEditKeyHandler) {
      window.removeEventListener('keydown', this.vertexEditKeyHandler);
      this.vertexEditKeyHandler = null;
    }
    if (this.vertexEditMapClickListener && this.map) {
      this.map.un('click', this.vertexEditMapClickListener);
      this.vertexEditMapClickListener = null;
    }
    this.updateVertexEditStyles = null;
    editSessionHistory.clearSession();
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
    initialGeoJson?: any,
  ) {
    let targetLayer: VectorLayer<any> | null = null;
    let initialFeature: Feature | null = null;
    
    const isCoreLayer = ['streetlights', 'roads', 'zones', 'states', 'districts'].includes(layerName);
    
    if (layerName === 'streetlights') targetLayer = this.streetlightsWfsLayer;
    else if (layerName === 'roads') targetLayer = this.roadsWfsLayer;
    else if (layerName === 'zones') targetLayer = this.zonesWfsLayer;
    else if (layerName === 'states') targetLayer = this.statesWfsLayer;
    else if (layerName === 'districts') targetLayer = this.districtsWfsLayer;
    else targetLayer = this.dynamicVectorLayer;

    const select = new Select({
      layers: targetLayer ? [targetLayer] : [],
      hitTolerance: 6,
    });

    if (featureId) {
      if (isCoreLayer) {
        initialFeature = this.getWfsFeature(layerName, featureId);
      } else {
        initialFeature = (this.dynamicVectorSource.getFeatureById(featureId) as Feature) || null;
        if (!initialFeature && initialGeoJson) {
          const rawFeature = new GeoJSON().readFeature(initialGeoJson, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857'
          });
          const dynamicFeat: Feature = (Array.isArray(rawFeature) ? rawFeature[0] : rawFeature) as Feature;
          if (!dynamicFeat.getId() && featureId) {
            dynamicFeat.setId(featureId);
          }
          this.dynamicVectorSource.addFeature(dynamicFeat);
          initialFeature = dynamicFeat;
        }
      }
      
      if (initialFeature) {
        select.getFeatures().push(initialFeature);
      }
    }

    this.currentTranslateTargetFeature = initialFeature;
    const initGeom = initialFeature?.getGeometry();
    if (initGeom) {
      const initGeoJson = new GeoJSON().writeGeometryObject(initGeom, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857',
      });
      editSessionHistory.startSession('move', initGeoJson);
    }

    const translate = new Translate({
      features: select.getFeatures(),
      hitTolerance: 6,
    });

    let originalGeometryClone: any = initialFeature?.getGeometry()?.clone() || null;
    let targetFeature: Feature | null = initialFeature;

    translate.on('translatestart', (event: any) => {
      const fList = event.features?.getArray ? event.features.getArray() : (Array.isArray(event.features) ? event.features : []);
      const f = fList[0] || targetFeature;
      if (f) {
        targetFeature = f;
        this.currentTranslateTargetFeature = f;
        const geom = f.getGeometry();
        if (geom) {
          originalGeometryClone = geom.clone();
        }
      }
    });

    translate.on('translateend', (event: any) => {
      let fList = event.features?.getArray ? event.features.getArray() : (Array.isArray(event.features) ? event.features : []);
      if (Array.isArray(fList[0])) fList = fList[0];
      const translatedFeature = fList[0] || targetFeature;
      if (translatedFeature) {
        this.currentTranslateTargetFeature = translatedFeature;
        const curGeom = translatedFeature.getGeometry();
        if (curGeom) {
          const curGeomGeoJson = new GeoJSON().writeGeometryObject(curGeom, {
            dataProjection: 'EPSG:4326',
            featureProjection: 'EPSG:3857',
          });
          editSessionHistory.pushSnapshot(curGeomGeoJson);
        }

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
    this.currentDrawSketchFeature = null;
    this.currentDrawInteraction = null;
    this.drawRedoCoordinates = [];
    this.currentTranslateTargetFeature = null;
    editSessionHistory.clearSession();
    this.cleanupDynamicSelect();
    this.activateInteraction(null);
    this.drawSource.clear();

    // Re-attach the singleclick select listener so the user can keep clicking features
    if (this.savedSelectCallback && this.map) {
      this.dynamicSelectKey = this.map.on('singleclick', async (evt) => {
        if (!this.map) return;
        const candidates: { feature: Feature; layerName: string; priority: number }[] = [];
        this.map.forEachFeatureAtPixel(
          evt.pixel,
          (feature, layer) => {
            if (!feature || !layer) return;
            let layerName = '';
            let priority = 0;
            if (layer === this.streetlightsWfsLayer && this.isLayerVisible('streetlights')) { layerName = 'streetlights'; priority = 100; }
            else if (layer === this.roadsWfsLayer && this.isLayerVisible('roads')) { layerName = 'roads'; priority = 80; }
            else if (layer === this.zonesWfsLayer && this.isLayerVisible('zones')) { layerName = 'zones'; priority = 60; }
            else if (layer === this.dynamicVectorLayer) { layerName = this.selectedLayerName || 'dynamic'; priority = 50; }
            else if (layer === this.districtsWfsLayer && this.isLayerVisible('districts')) { layerName = 'districts'; priority = 30; }
            else if (layer === this.statesWfsLayer && this.isLayerVisible('states')) { layerName = 'states'; priority = 10; }
            if (layerName) {
              const rawId = String(parseFeatureId((feature as any).getId()) ?? (feature as any).getId());
              if (!this.hiddenFeatureIds[layerName]?.has(rawId)) {
                candidates.push({ feature: feature as Feature, layerName, priority });
              }
            }
          },
          { hitTolerance: 12 }
        );
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.priority - a.priority);
          const top = candidates[0];
          const geojsonFeature = new GeoJSON().writeFeatureObject(top.feature, {
            dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857',
          });
          this.setSelectedFeature(top.layerName, geojsonFeature.id ?? null, geojsonFeature);
          this.savedSelectCallback!(geojsonFeature, top.layerName);
        }
      });
    }
  }
}

export const olService = new OpenLayersService();
if (typeof window !== 'undefined') {
  (window as any).__olService = olService;
}
