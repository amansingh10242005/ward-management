import React, { useState, useEffect } from 'react';
import { apiClient } from '../../lib/api';
import { parseFeatureId } from '../../utils/featureUtils';

interface DistrictsFormProps {
  feature: any | null;
  mode: 'create' | 'edit' | 'move';
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  onMoveStart?: () => void;
}

const DistrictsForm: React.FC<DistrictsFormProps> = ({ feature, onSuccess }) => {
  const [name, setName] = useState('');
  const [state, setState] = useState('');
  const [districtCode, setDistrictCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (feature?.properties) {
      setName(feature.properties.District || feature.properties.district_name || feature.properties.name || '');
      setState(feature.properties.STATE || feature.properties.State || feature.properties.state_name || '');
      setDistrictCode(feature.properties.DISTRICT_L || feature.properties.district_code || '');
    } else {
      setName('');
      setState('');
      setDistrictCode('');
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
          District: name,
          STATE: state,
          DISTRICT_L: districtCode,
        },
      };
      await apiClient.districts.update(rawId as string, payload);
      onSuccess('update', feature.id as string);
    } catch (err: any) {
      setError(err.message || 'Failed to update district.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="inspector-edit-label">Edit District</div>

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="form-group">
          <label className="form-label">District Name</label>
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
          <label className="form-label">State</label>
          <input
            className="form-input"
            type="text"
            value={state}
            onChange={(e) => setState(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="form-group">
          <label className="form-label">LGD Code</label>
          <input
            className="form-input"
            type="text"
            value={districtCode}
            onChange={(e) => setDistrictCode(e.target.value)}
            placeholder="e.g. 582"
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

export default DistrictsForm;
