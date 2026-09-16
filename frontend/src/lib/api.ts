/**
 * api.ts — API client module for talking to the Express backend.
 *
 * Responsibilities:
 *  - Provide strongly-typed wrapper functions for fetch() calls
 *  - ONLY implement the write path (CRUD for the layers)
 *  - No GeoServer URLs belong here.
 */

import type { StreetlightFeature } from '../types/streetlights';

const API_BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = 'API request failed';
    try {
      const errorData = await res.json();
      message = errorData.reason 
        ? `${errorData.error}: ${errorData.reason}` 
        : (errorData.error?.message || errorData.error || message);
    } catch {
      // Body not JSON
    }
    throw new ApiError(res.status, message);
  }
  
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

// Cache state for GeoServer metadata
let cachedLayers: any[] | null = null;
let layersInFlight: Promise<any[]> | null = null;
const cachedSchemas = new Map<string, any>();
const schemasInFlight = new Map<string, Promise<any>>();

export const apiClient = {
  streetlights: {
    create: async (feature: StreetlightFeature): Promise<StreetlightFeature> => {
      const res = await fetch(`${API_BASE}/streetlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<StreetlightFeature>(res);
    },
    update: async (id: number | string, feature: StreetlightFeature): Promise<StreetlightFeature> => {
      const res = await fetch(`${API_BASE}/streetlights/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<StreetlightFeature>(res);
    },
    delete: async (id: number | string): Promise<void> => {
      const res = await fetch(`${API_BASE}/streetlights/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(res);
    },
  },

  roads: {
    create: async (feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/roads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    update: async (id: number | string, feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/roads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    delete: async (id: number | string): Promise<void> => {
      const res = await fetch(`${API_BASE}/roads/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(res);
    },
  },

  zones: {
    create: async (feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    update: async (id: number | string, feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/zones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    delete: async (id: number | string): Promise<void> => {
      const res = await fetch(`${API_BASE}/zones/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(res);
    },
  },

  districts: {
    update: async (id: number | string, feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/districts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    delete: async (id: number | string): Promise<void> => {
      const res = await fetch(`${API_BASE}/districts/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(res);
    },
  },

  states: {
    update: async (id: number | string, feature: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/states/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feature),
      });
      return handleResponse<any>(res);
    },
    delete: async (id: number | string): Promise<void> => {
      const res = await fetch(`${API_BASE}/states/${id}`, {
        method: 'DELETE',
      });
      return handleResponse<void>(res);
    },
  },

  spatial: {
    getExtent: async (layerName: string): Promise<[number, number, number, number] | null> => {
      const res = await fetch(`${API_BASE}/spatial/extent/${layerName}`);
      const data = await handleResponse<{ extent: [number, number, number, number] | null }>(res);
      return data.extent;
    },
    getFeatureExtent: async (layerName: string, id: string | number): Promise<[number, number, number, number] | null> => {
      const res = await fetch(`${API_BASE}/spatial/extent/${layerName}/${id}`);
      const data = await handleResponse<{ extent: [number, number, number, number] | null }>(res);
      return data.extent;
    },
  },

  geoserver: {
    getLayers: async (forceRefresh = false): Promise<any[]> => {
      if (forceRefresh) {
        cachedLayers = null;
      }
      if (!forceRefresh && cachedLayers) {
        return cachedLayers;
      }
      if (!forceRefresh && layersInFlight) {
        return layersInFlight;
      }
      layersInFlight = (async () => {
        try {
          const url = forceRefresh ? `${API_BASE}/geoserver/layers?_t=${Date.now()}` : `${API_BASE}/geoserver/layers`;
          const res = await fetch(url, { cache: forceRefresh ? 'no-store' : 'default' });
          const data = await handleResponse<{ layers: any[] }>(res);
          cachedLayers = data.layers;
          return data.layers;
        } finally {
          layersInFlight = null;
        }
      })();
      return layersInFlight;
    },
    getSchema: async (layerName: string, forceRefresh = false): Promise<any> => {
      if (!forceRefresh && cachedSchemas.has(layerName)) {
        return cachedSchemas.get(layerName);
      }
      if (!forceRefresh && schemasInFlight.has(layerName)) {
        return schemasInFlight.get(layerName)!;
      }
      const p = (async () => {
        try {
          const res = await fetch(`${API_BASE}/geoserver/schema/${layerName}`);
          const schema = await handleResponse<any>(res);
          cachedSchemas.set(layerName, schema);
          return schema;
        } finally {
          schemasInFlight.delete(layerName);
        }
      })();
      schemasInFlight.set(layerName, p);
      return p;
    },
    clearCache: () => {
      cachedLayers = null;
      layersInFlight = null;
      cachedSchemas.clear();
      schemasInFlight.clear();
    },
    transaction: async (payload: any): Promise<any> => {
      const res = await fetch(`${API_BASE}/geoserver/wfs/transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return handleResponse<any>(res);
    },
    getFeatures: async (layerName: string, queryParams: Record<string, any> = {}): Promise<any> => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(queryParams)) {
        if (v !== undefined && v !== null && v !== '') {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString() ? `?${sp.toString()}` : '';
      const res = await fetch(`${API_BASE}/geoserver/layers/${layerName}/features${qs}`);
      return handleResponse<any>(res);
    },
  },
};

if (typeof window !== 'undefined') {
  (window as any).__apiClient = apiClient;
}
