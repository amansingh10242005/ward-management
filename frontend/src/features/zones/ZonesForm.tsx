import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { ZoneFeature } from '../../types/gis';
import { parseFeatureId } from '../../utils/featureUtils';

interface ZonesFormProps {
  feature: ZoneFeature | null;
  mode: 'create' | 'edit' | 'move';
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  onMoveStart?: () => void;
}

const ZonesForm: React.FC<ZonesFormProps> = ({ feature, mode, onSuccess, onCancel, onMoveStart }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState('residential');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (feature && feature.properties) {
      setName(feature.properties.name || '');
      setType(feature.properties.type || 'residential');
    } else {
      setName('');
      setType('residential');
    }
    setConfirmDelete(false);
    setError(null);
  }, [feature]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        type: 'Feature',
        geometry: feature!.geometry,
        properties: { name, type },
      };

      if (mode === 'edit' && feature!.id) {
        const rawId = parseFeatureId(feature!.id);
        await apiClient.zones.update(rawId as string, payload as any);
        onSuccess('update', feature!.id as string);
      } else {
        await apiClient.zones.create(payload as any);
        onSuccess('create');
      }
    } catch (err: any) {
      console.error('Failed to save zone:', err);
      setError(err.message || 'An unexpected error occurred while saving.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (feature && feature!.id) {
        const rawId = parseFeatureId(feature!.id);
        await apiClient.zones.delete(rawId as string);
        onSuccess('delete', feature!.id as string);
      }
    } catch (err: any) {
      console.error('Failed to delete zone:', err);
      if (err.status === 404) {
        setError('This feature was already deleted by another user.');
        setTimeout(() => onSuccess('delete', feature?.id as string), 2000);
      } else {
        setError(err.message || 'An unexpected error occurred while deleting.');
      }
    } finally {
      setIsSubmitting(false);
      setConfirmDelete(false);
    }
  };

  // Format a created_at timestamp if available
  const createdDate = feature?.properties?.created_at
    ? new Date(feature.properties.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Inspector heading */}
      <div className="inspector-edit-label">
        {mode === 'edit' ? 'Edit Zone' : 'New Zone'}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        {/* Name */}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input
            className="form-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. T. Nagar Commercial Zone"
            disabled={isSubmitting}
          />
        </div>

        {/* Type */}
        <div className="form-group">
          <label className="form-label">Type</label>
          <div className="form-select-wrap">
            <select
              className="form-select"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={isSubmitting}
            >
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="park">Park</option>
            </select>
          </div>
        </div>

        {/* Created Date — show only when available */}
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

        {/* Action buttons */}
        <div className="inspector-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>

          {mode === 'edit' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onMoveStart}
                disabled={isSubmitting}
              >
                Move
              </button>
              <button
                type="button"
                className={`btn ${confirmDelete ? 'btn-danger' : 'btn-secondary'}`}
                onClick={handleDelete}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? 'Deleting…'
                  : confirmDelete
                    ? 'Confirm Delete'
                    : 'Delete'}
              </button>
            </>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default ZonesForm;
