import React, { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import { IconCheck } from './Icons';
import { historyService } from '../services/historyService';

interface DynamicFeatureFormProps {
  feature: any;
  mode: 'idle' | 'create' | 'edit' | 'move' | 'vertex_edit';
  layerName: string;
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string, layerName?: string) => void;
  onCancel: () => void;
  onMoveStart: () => void;
}

const DynamicFeatureForm: React.FC<DynamicFeatureFormProps> = ({
  feature,
  mode,
  layerName,
  onSuccess,
  onCancel,
  onMoveStart,
}) => {
  const [schema, setSchema] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    let isMounted = true;
    apiClient.geoserver.getSchema(layerName)
      .then(res => {
        if (isMounted) setSchema(res);
      })
      .catch(err => {
        if (isMounted) setError('Failed to load layer schema.');
        console.error(err);
      });
      
    return () => { isMounted = false; };
  }, [layerName]);
  
  useEffect(() => {
    if (feature?.properties) {
      setFormData({ ...feature.properties });
    } else {
      setFormData({});
    }
  }, [feature]);

  if (!schema) {
    return <div className="p-4 text-gray-500">Loading schema...</div>;
  }
  
  const editableProperties = schema.properties.filter((p: any) => 
    !p.type.startsWith('gml:') && p.name !== 'id' && p.name !== 'fid'
  );
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'vertex_edit') return; // Handled by vertex editing flow
    
    setLoading(true);
    setError(null);

    const beforeGeom = feature?.geometry ? JSON.parse(JSON.stringify(feature.geometry)) : null;
    const beforeProps = feature?.properties ? JSON.parse(JSON.stringify(feature.properties)) : {};
    const fid = feature.id;
    
    try {
      const payload = {
        layerName,
        featureId: feature.id,
        action: 'update',
        feature: {
          type: 'Feature',
          geometry: feature.geometry,
          properties: formData,
        }
      };
      
      await apiClient.geoserver.transaction(payload);

      historyService.recordSuccess({
        operationType: 'update',
        layerName,
        isCore: false,
        originalFeatureId: fid,
        currentFeatureId: fid,
        before: {
          geometry: beforeGeom,
          properties: beforeProps,
        },
        after: {
          geometry: feature.geometry,
          properties: formData,
        },
      });

      onSuccess('update', feature.id, layerName);
    } catch (err: any) {
      setError(err.message || 'Failed to update feature');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <h2>{layerName} (Dynamic)</h2>
      </div>

      <div className="inspector-content">
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          {editableProperties.map((prop: any) => (
            <div className="form-group" key={prop.name}>
              <label>{prop.name} ({prop.localType})</label>
              <input
                type={prop.localType === 'int' || prop.localType === 'double' ? 'number' : 'text'}
                className="form-control"
                name={prop.name}
                value={formData[prop.name] || ''}
                onChange={handleChange}
                disabled={loading || mode === 'vertex_edit'}
              />
            </div>
          ))}

          <div className="inspector-actions">
            {mode === 'edit' && (
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={onMoveStart} 
                disabled={loading}
              >
                Move Feature
              </button>
            )}
            {mode === 'edit' && (
              <button 
                type="submit" 
                className="btn btn-primary" 
                disabled={loading}
              >
                <IconCheck width={16} height={16} /> Save Attributes
              </button>
            )}
            <button 
              type="button" 
              className="btn btn-outline" 
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DynamicFeatureForm;
