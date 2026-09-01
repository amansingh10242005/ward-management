import React from 'react';
import StreetlightsForm from '../features/streetlights/StreetlightsForm';
import RoadsForm from '../features/roads/RoadsForm';
import ZonesForm from '../features/zones/ZonesForm';
import { IconMapPin } from './Icons';

interface FeatureFormProps {
  feature: any | null;
  mode: 'idle' | 'create' | 'edit' | 'move';
  activeLayer: 'streetlights' | 'roads' | 'zones' | 'states' | 'districts' | null;
  onSuccess: (action?: 'create' | 'update' | 'delete', featureId?: string) => void;
  onCancel: () => void;
  onMoveStart: () => void;
  selectedZoneFeature?: any;
  selectedRoadFeature?: any;
}

const FeatureForm: React.FC<FeatureFormProps> = ({ feature, mode, activeLayer, onSuccess, onCancel, onMoveStart, selectedZoneFeature, selectedRoadFeature }) => {
  if (mode === 'idle' || !activeLayer) {
    return (
      <div className="inspector-empty">
        <IconMapPin width={40} height={40} />
        <div className="inspector-empty-title">
          No feature selected
        </div>
        <div className="inspector-empty-hint">
          Click any infrastructure asset on<br />the map to inspect and edit it.
        </div>
      </div>
    );
  }

  if (mode === 'move') {
    return (
      <div className="inspector-empty">
        <IconMapPin width={40} height={40} />
        <div className="inspector-empty-title">Move Feature</div>
        <div className="inspector-empty-hint">Drag the feature on the map to move it.</div>
        <div className="inspector-actions" style={{ marginTop: '20px', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel Move</button>
        </div>
      </div>
    );
  }

  switch (activeLayer) {
    case 'streetlights':
      return <StreetlightsForm feature={feature} mode={mode} onSuccess={onSuccess} onCancel={onCancel} onMoveStart={onMoveStart} selectedZoneFeature={selectedZoneFeature} selectedRoadFeature={selectedRoadFeature} />;
    case 'roads':
      return <RoadsForm feature={feature} mode={mode} onSuccess={onSuccess} onCancel={onCancel} onMoveStart={onMoveStart} selectedZoneFeature={selectedZoneFeature} />;
    case 'zones':
      return <ZonesForm feature={feature} mode={mode} onSuccess={onSuccess} onCancel={onCancel} onMoveStart={onMoveStart} />;
    case 'states':
      return (
        <div className="inspector-content">
          <div className="inspector-header">
            <h3>State Boundary</h3>
            <div className="inspector-id">ID: {feature?.id}</div>
          </div>
          <div className="inspector-body">
            <div className="form-group">
              <label>State Name</label>
              <div className="readonly-val">{feature?.properties?.STATE || feature?.properties?.state_name || 'N/A'}</div>
            </div>
            <div className="form-group">
              <label>State Code</label>
              <div className="readonly-val">{feature?.properties?.state_code || 'N/A'}</div>
            </div>
          </div>
        </div>
      );
    case 'districts':
      return (
        <div className="inspector-content">
          <div className="inspector-header">
            <h3>District Boundary</h3>
            <div className="inspector-id">ID: {feature?.id}</div>
          </div>
          <div className="inspector-body">
            <div className="form-group">
              <label>District Name</label>
              <div className="readonly-val">{feature?.properties?.District || feature?.properties?.district_name || 'N/A'}</div>
            </div>
            <div className="form-group">
              <label>State</label>
              <div className="readonly-val">{feature?.properties?.State || 'N/A'}</div>
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
};

export default FeatureForm;
