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

// ── Service class ─────────────────────────────────────────────────────────────

export class OpenLayersService {
  private map: Map | null = null;
  private layers: Record<string, TileLayer<TileWMS>> = {};

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

  private streetlightsWfsLayer = new VectorLayer({
    source: this.streetlightsWfsSource,
    style:  (feature: any) => {
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
    style:  (feature: any) => {
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
    style:  (feature: any) => {
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
    style:  (feature: any) => {
      const name = feature.get('STATE'); // or STATE_LGD
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
    visible: false,
  });

  private districtsWfsLayer = new VectorLayer({
    source: this.districtsWfsSource,
    style:  (feature: any) => {
      const name = feature.get('District');
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
    visible: false,
  });

  private activeInteractions: Interaction[] = [];
  private rotationListeners: ((rotation: number) => void)[] = [];
  private moveEndListeners: (() => void)[] = [];

  private basemapLayer: TileLayer<any> | null = null;
  private currentBasemap: BasemapId = 'carto_dark';
  private basemapChangeListeners: ((id: BasemapId) => void)[] = [];

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
        }),
        visible: true,
      }),
      states: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:states`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      districts: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:districts`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: false,
      }),
      roads: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:roads`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
        }),
        visible: true,
      }),
      streetlights: new TileLayer({
        source: new TileWMS({
          url:        `${GEOSERVER_URL}/${WORKSPACE}/wms`,
          params:     { LAYERS: `${WORKSPACE}:streetlights`, TILED: true, TRANSPARENT: true, FORMAT: 'image/png' },
          serverType: 'geoserver',
          crossOrigin: 'anonymous',
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

    this.map.on('moveend', () => {
      this.moveEndListeners.forEach(l => l());
    });
  }

  getMap(): Map | null {
    return this.map;
  }

  // ── Selected feature glow ────────────────────────────────────────────────────

  /**
   * Tell the WFS vector layers which feature is selected so their style
   * functions can apply the neon glow. Pass (null, null) to clear selection.
   */
  setSelectedFeature(layerName: string | null, featureId: string | number | null) {
    this.selectedLayerName  = layerName;
    this.selectedFeatureId  = featureId;
    // Re-render all WFS layers to apply new styles
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

  async searchFeaturesFromBackend(layerName: string, search: string = ''): Promise<any[]> {
    if (!this.map) return [];
    
    let cqlFilter = '';
    if (search.trim()) {
      const searchStr = search.replace(/'/g, "''");
      switch (layerName) {
        case 'states':
          cqlFilter = `STATE ILIKE '%${searchStr}%' OR state_name ILIKE '%${searchStr}%'`;
          break;
        case 'districts':
          cqlFilter = `District ILIKE '%${searchStr}%' OR district_name ILIKE '%${searchStr}%'`;
          break;
        case 'zones':
        case 'roads':
          cqlFilter = `name ILIKE '%${searchStr}%'`;
          break;
        case 'streetlights':
          cqlFilter = `identifier ILIKE '%${searchStr}%' OR name ILIKE '%${searchStr}%'`;
          break;
      }
    }

    const baseUrl = GEOSERVER_URL.startsWith('http') ? GEOSERVER_URL : window.location.origin + GEOSERVER_URL;
    const url = new URL(`${baseUrl}/${WORKSPACE}/ows`);
    url.searchParams.append('service', 'WFS');
    url.searchParams.append('version', '1.1.0');
    url.searchParams.append('request', 'GetFeature');
    url.searchParams.append('typeName', `${WORKSPACE}:${layerName}`);
    url.searchParams.append('outputFormat', 'application/json');
    url.searchParams.append('srsname', 'EPSG:3857');
    if (cqlFilter) {
      url.searchParams.append('cql_filter', cqlFilter);
    }

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const data = await res.json();
      return data.features || [];
    } catch (err) {
      console.error('Failed to search features from backend', err);
      return [];
    }
  }

  onMoveEnd(listener: () => void) {
    this.moveEndListeners.push(listener);
    return () => {
      this.moveEndListeners = this.moveEndListeners.filter(l => l !== listener);
    };
  }

  centerOnFeature(layerName: string, featureId: string | number) {
    if (!this.map) return;
    let source;
    if (layerName === 'zones') source = this.zonesWfsSource;
    else if (layerName === 'roads') source = this.roadsWfsSource;
    else if (layerName === 'streetlights') source = this.streetlightsWfsSource;
    else if (layerName === 'states') source = this.statesWfsSource;
    else if (layerName === 'districts') source = this.districtsWfsSource;
    
    if (!source) return;
    
    const feature = source.getFeatureById(featureId);
    if (feature) {
      const geometry = feature.getGeometry();
      if (geometry) {
        this.map.getView().fit(geometry.getExtent(), {
          padding: [50, 50, 50, 50],
          maxZoom: 18,
          duration: 500
        });
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

  refreshLayer(layerName: string) {
    if (this.layers[layerName]) {
      const source = this.layers[layerName].getSource();
      if (source) source.updateParams({ _ts: Date.now() });
    }
    if (layerName === 'streetlights') this.streetlightsWfsSource.refresh();
    else if (layerName === 'roads')   this.roadsWfsSource.refresh();
    else if (layerName === 'zones')   this.zonesWfsSource.refresh();
    else if (layerName === 'states')  this.statesWfsSource.refresh();
    else if (layerName === 'districts') this.districtsWfsSource.refresh();
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

  activateModify(
    onSelect:    (feature: any, layerName: string) => void,
    onModifyEnd: (feature: any) => void,
  ) {
    const select = new Select({
      layers: [this.streetlightsWfsLayer, this.roadsWfsLayer, this.zonesWfsLayer, this.statesWfsLayer, this.districtsWfsLayer],
      hitTolerance: 5,
    });

    const modify = new Modify({
      features: select.getFeatures(),
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

    modify.on('modifyend', (event) => {
      const modifiedFeature = event.features.getArray()[0];
      if (modifiedFeature) {
        const geojsonFeature = new GeoJSON().writeFeatureObject(modifiedFeature, {
          dataProjection:    'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        onModifyEnd(geojsonFeature);
      }
    });

    this.activateInteraction([select, modify]);
  }

  activateTranslate(
    onTranslateEnd: (feature: any) => void,
  ) {
    const select = new Select({
      layers: [this.streetlightsWfsLayer, this.roadsWfsLayer, this.zonesWfsLayer],
      hitTolerance: 5,
    });

    const translate = new Translate({
      features: select.getFeatures(),
    });

    translate.on('translateend', (event) => {
      const translatedFeature = event.features.getArray()[0];
      if (translatedFeature) {
        const geojsonFeature = new GeoJSON().writeFeatureObject(translatedFeature, {
          dataProjection: 'EPSG:4326',
          featureProjection: 'EPSG:3857',
        });
        onTranslateEnd(geojsonFeature);
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
