import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { StreetlightFeature, ZoneFeature, RoadFeature } from '../../types/gis';
import { parseFeatureId } from '../../utils/featureUtils';

interface StreetlightsFormProps {
  feature: StreetlightFeature | null;
  mode: 'create' | 'edit' | 'move';
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  onMoveStart?: () => void;
  selectedZoneFeature?: ZoneFeature | null;
  selectedRoadFeature?: RoadFeature | null;
}

const StreetlightsForm: React.FC<StreetlightsFormProps> = ({ feature, mode, onSuccess, selectedZoneFeature, selectedRoadFeature }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('standard');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (feature && feature.properties) {
      setName(feature.properties.name || '');
      setType(feature.properties.type || 'standard');
    } else {
      setName('');
      setType('standard');
    }
    setError(null);
  }, [feature]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const rawZoneId = selectedZoneFeature?.id
        ? (parseFeatureId(selectedZoneFeature.id) as number)
        : null;

      const rawRoadId = selectedRoadFeature?.id
        ? (parseFeatureId(selectedRoadFeature.id) as number)
        : null;

      const payload = {
        type: 'Feature',
        geometry: feature!.geometry,
        properties: { 
          name, 
          type,
          zone_id: feature?.properties?.zone_id || rawZoneId,
          road_id: feature?.properties?.road_id || rawRoadId
        },
      };

      if (mode === 'edit' && feature!.id) {
        const rawId = parseFeatureId(feature!.id);
        await apiClient.streetlights.update(rawId as string, payload as any);
        onSuccess('update', feature!.id as string);
      } else {
        await apiClient.streetlights.create(payload as any);
        onSuccess('create');
      }
    } catch (err: any) {
      console.error('Failed to save streetlight:', err);
      setError(err.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsSubmitting(false);
    }
  };


  const createdDate = feature?.properties?.created_at
    ? new Date(feature.properties.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="inspector-edit-label">
        {mode === 'edit' ? 'Edit Streetlight' : 'New Streetlight'}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. SL-101"
            disabled={isSubmitting}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Type</label>
          <div className="form-select-wrap">
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="standard">Standard</option>
              <option value="solar">Solar</option>
              <option value="LED">LED</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Zone</label>
          <input
            className="form-input"
            type="text"
            value={feature?.properties?.zone_id ? `Zone ${feature.properties.zone_id}` : (selectedZoneFeature ? selectedZoneFeature.properties?.name || `Zone ${selectedZoneFeature.id}` : 'Unassigned')}
            readOnly
            tabIndex={-1}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Road</label>
          <input
            className="form-input"
            type="text"
            value={feature?.properties?.road_id ? `Road ${feature.properties.road_id}` : (selectedRoadFeature ? selectedRoadFeature.properties?.name || `Road ${selectedRoadFeature.id}` : 'Unassigned')}
            readOnly
            tabIndex={-1}
          />
        </div>

        {createdDate && (
          <div className="form-group">
            <label className="form-label">Created Date</label>
            <input
              className="form-input"
              type="text"
              value={createdDate}
              readOnly
              tabIndex={-1}
            />
          </div>
        )}

        <div className="inspector-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default StreetlightsForm;
