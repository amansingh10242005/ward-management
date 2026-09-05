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
};
