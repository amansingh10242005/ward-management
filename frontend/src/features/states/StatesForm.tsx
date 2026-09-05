import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { parseFeatureId } from '../../utils/featureUtils';

interface StatesFormProps {
  feature: any | null;
  mode: 'create' | 'edit' | 'move';
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  onMoveStart?: () => void;
}

const StatesForm: React.FC<StatesFormProps> = ({ feature, onSuccess }) => {
  const [name, setName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (feature?.properties) {
      setName(feature.properties.STATE || feature.properties.state_name || feature.properties.name || '');
      setStateCode(feature.properties.State_LGD != null ? String(feature.properties.State_LGD) : (feature.properties.state_code || ''));
    } else {
      setName('');
      setStateCode('');
    }
    setError(null);
  }, [feature]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feature?.id) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const rawId = parseFeatureId(feature.id);
      const payload = {
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          STATE: name,
          State_LGD: stateCode,
        },
      };
      await apiClient.states.update(rawId as string, payload);
      onSuccess('update', feature.id as string);
    } catch (err: any) {
      setError(err.message || 'Failed to update state.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="inspector-edit-label">Edit State</div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="form-group">
          <label className="form-label">State Name</label>
          <input
            className="form-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSubmitting}
          />
        </div>

        <div className="form-group">
          <label className="form-label">State LGD Code</label>
          <input
            className="form-input"
            type="text"
            value={stateCode}
            onChange={(e) => setStateCode(e.target.value)}
            placeholder="e.g. 33"
            disabled={isSubmitting}
          />
        </div>

        <div className="inspector-actions">
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default StatesForm;
